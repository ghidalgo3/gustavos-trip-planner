-- Physical hotels have identities independent of the visits that select them.
CREATE TABLE hotels (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
    address text CHECK(length(address)<=2000),
    location geography(Point,4326) NOT NULL,
    time_zone text,
    version bigint NOT NULL DEFAULT 1,
    UNIQUE(id,trip_id)
);
ALTER TABLE destination_stay_locations ADD COLUMN hotel_id uuid;
UPDATE destination_stay_locations SET hotel_id=gen_random_uuid();
INSERT INTO hotels(id,trip_id,name,location)
SELECT hotel_id,trip_id,feature->'properties'->>'name',
       ST_SetSRID(ST_GeomFromGeoJSON((feature->'geometry')::text),4326)::geography
FROM destination_stay_locations;
ALTER TABLE destination_stay_locations ALTER COLUMN hotel_id SET NOT NULL;
ALTER TABLE destination_stay_locations ADD FOREIGN KEY(hotel_id,trip_id) REFERENCES hotels(id,trip_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE destination_stay_locations DROP COLUMN feature;

CREATE FUNCTION hotel_document(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('id',id,'tripId',trip_id,'name',name,'address',address,
        'geometry',ST_AsGeoJSON(location::geometry)::jsonb,'timeZone',time_zone,'version',version)
    FROM hotels WHERE id=target
$$;
CREATE FUNCTION hotel_stay_feature(visit uuid,hotel uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('type','Feature','id',visit,'geometry',ST_AsGeoJSON(location::geometry)::jsonb,
        'properties',jsonb_build_object('name',name,'address',address,'hotelId',id)) FROM hotels WHERE id=hotel
$$;

CREATE TABLE airports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z]{3}$'),
    name text NOT NULL,
    city text NOT NULL,
    country text NOT NULL,
    location geography(Point,4326),
    time_zone text,
    major boolean NOT NULL DEFAULT false,
    keywords text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true,
    refreshed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activities ADD CONSTRAINT activities_id_trip UNIQUE(id,trip_id);
CREATE TABLE transportation (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
    route_features jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(route_features)='array'),
    version bigint NOT NULL DEFAULT 1,
    route_stale boolean NOT NULL DEFAULT false,
    UNIQUE(id,trip_id)
);

CREATE FUNCTION transportation_point_valid(feature jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(feature->>'type'='Feature'
        AND feature->'geometry'->>'type'='Point'
        AND jsonb_typeof(feature->'geometry'->'coordinates')='array'
        AND jsonb_array_length(feature->'geometry'->'coordinates')=2
        AND jsonb_typeof(feature->'geometry'->'coordinates'->0)='number'
        AND jsonb_typeof(feature->'geometry'->'coordinates'->1)='number'
        AND (feature->'geometry'->'coordinates'->>0)::numeric BETWEEN -180 AND 180
        AND (feature->'geometry'->'coordinates'->>1)::numeric BETWEEN -90 AND 90
        AND length(btrim(feature->'properties'->>'name')) BETWEEN 1 AND 200,false)
$$;

CREATE TABLE transportation_endpoints (
    transportation_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    role text NOT NULL CHECK(role IN ('from','to')),
    activity_id uuid,
    airport_id uuid REFERENCES airports(id) DEFERRABLE INITIALLY DEFERRED,
    hotel_id uuid,
    home_user_id uuid REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
    feature jsonb NOT NULL,
    PRIMARY KEY(transportation_id,role),
    FOREIGN KEY(transportation_id,trip_id) REFERENCES transportation(id,trip_id) ON DELETE CASCADE,
    FOREIGN KEY(activity_id,trip_id) REFERENCES activities(id,trip_id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(hotel_id,trip_id) REFERENCES hotels(id,trip_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK((feature->>'id') IS NOT DISTINCT FROM role),
    CHECK((feature->>'type') IS NOT DISTINCT FROM 'Feature'),
    CHECK(num_nonnulls(activity_id,airport_id,hotel_id,home_user_id)<=1),
    CHECK(num_nonnulls(activity_id,airport_id,hotel_id,home_user_id)=1 OR (
        transportation_point_valid(feature) AND (feature#>'{properties,reference}' IS NULL OR feature#>'{properties,reference}'='null'::jsonb)))
);
CREATE INDEX transportation_activity ON transportation_endpoints(activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX transportation_airport ON transportation_endpoints(airport_id) WHERE airport_id IS NOT NULL;
CREATE INDEX transportation_hotel ON transportation_endpoints(hotel_id) WHERE hotel_id IS NOT NULL;
CREATE INDEX transportation_home ON transportation_endpoints(home_user_id) WHERE home_user_id IS NOT NULL;

CREATE FUNCTION validate_transportation_endpoints() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
    IF TG_TABLE_NAME='transportation' THEN target:=NEW.id;
    ELSE target:=COALESCE(NEW.transportation_id,OLD.transportation_id); END IF;
    IF EXISTS(SELECT 1 FROM transportation WHERE id=target)
        AND (SELECT count(*) FROM transportation_endpoints WHERE transportation_id=target)<>2 THEN
        RAISE EXCEPTION 'Transportation requires exactly one from and one to endpoint' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transportation_has_endpoints AFTER INSERT OR UPDATE ON transportation
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_transportation_endpoints();
CREATE CONSTRAINT TRIGGER transportation_endpoint_pair AFTER INSERT OR UPDATE OR DELETE ON transportation_endpoints
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_transportation_endpoints();

CREATE FUNCTION transportation_endpoint_feature(e transportation_endpoints) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE source_id uuid; source_kind text; source_name text; source_address text; source_geometry jsonb;
BEGIN
    IF e.activity_id IS NOT NULL THEN
        SELECT id,properties->>'placeName',properties->>'address',ST_AsGeoJSON(location::geometry)::jsonb
        INTO source_id,source_name,source_address,source_geometry FROM activities WHERE id=e.activity_id;
        SELECT COALESCE(NULLIF(source_name,''),properties->>'name') INTO source_name FROM activities WHERE id=e.activity_id;
        source_kind:='activity';
    ELSIF e.hotel_id IS NOT NULL THEN
        SELECT id,name,address,ST_AsGeoJSON(location::geometry)::jsonb INTO source_id,source_name,source_address,source_geometry FROM hotels WHERE id=e.hotel_id;
        source_kind:='hotel';
    ELSIF e.airport_id IS NOT NULL THEN
        SELECT id,name,city,ST_AsGeoJSON(location::geometry)::jsonb INTO source_id,source_name,source_address,source_geometry FROM airports WHERE id=e.airport_id;
        source_kind:='airport';
    ELSIF e.home_user_id IS NOT NULL THEN
        SELECT id,COALESCE(home_city_name,'Home'),NULL,ST_AsGeoJSON(home_city_location::geometry)::jsonb INTO source_id,source_name,source_address,source_geometry FROM users WHERE id=e.home_user_id;
        source_kind:='home';
    ELSE
        RETURN e.feature;
    END IF;
    RETURN jsonb_build_object('type','Feature','id',e.role,'geometry',source_geometry,
        'properties',jsonb_build_object('name',source_name,'address',source_address,
            'reference',jsonb_build_object('kind',source_kind,'id',source_id)));
END $$;

CREATE FUNCTION transportation_document(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT document || jsonb_build_object('type','FeatureCollection','id',id,'version',version,
        'routeStale',route_stale,'features',COALESCE((SELECT jsonb_agg(transportation_endpoint_feature(e) ORDER BY e.role)
            FROM transportation_endpoints e WHERE e.transportation_id=t.id),'[]') || route_features)
    FROM transportation t WHERE id=target
$$;

-- Preserve existing saved journeys while removing the old collection resource.
DO $$
DECLARE plan record; journey jsonb; endpoint jsonb; direction text; source_place text; visit uuid; hotel uuid; city text; source_airport_code text; owner uuid; airport uuid; geometry jsonb; feature jsonb;
BEGIN
    FOR plan IN SELECT * FROM trip_travel_plans LOOP
        SELECT owner_user_id INTO owner FROM trips WHERE id=plan.trip_id;
        FOR journey IN SELECT * FROM jsonb_array_elements(plan.document) LOOP
            INSERT INTO transportation(id,trip_id,document,route_features)
            VALUES((journey->>'id')::uuid,plan.trip_id,jsonb_build_object('name',journey->>'name','notes','',
                'mode',journey->'mode','departureDate',journey->'departureDate','departureTime',journey->'departureTime',
                'timeZone',journey->'timeZone','duration',COALESCE(NULLIF(journey->'durationOverride','null'::jsonb),journey->'estimate'->'duration')),
                COALESCE((SELECT jsonb_agg(jsonb_build_object('type','Feature','id','step-'||position,'geometry',NULL,
                    'properties',jsonb_build_object('sequence',position-1,'mode',segment->'mode','duration',segment->'duration')) ORDER BY position)
                    FROM jsonb_array_elements(COALESCE(journey->'segments','[]'::jsonb)) WITH ORDINALITY AS segments(segment,position)),'[]'::jsonb));
            FOREACH direction IN ARRAY ARRAY['from','to'] LOOP
                endpoint:=journey->direction;
                feature:=jsonb_build_object('type','Feature','id',direction,'geometry',NULL,'properties',jsonb_build_object('name','Travel endpoint'));
                IF endpoint->>'activityId' IS NOT NULL THEN
                    INSERT INTO transportation_endpoints VALUES((journey->>'id')::uuid,plan.trip_id,direction,(endpoint->>'activityId')::uuid,NULL,NULL,NULL,feature);
                ELSIF endpoint->>'visitId' IS NOT NULL THEN
                    visit:=(endpoint->>'visitId')::uuid;
                    SELECT hotel_id INTO hotel FROM destination_stay_locations WHERE trip_id=plan.trip_id AND stay_id=visit;
                    IF hotel IS NOT NULL THEN
                        INSERT INTO transportation_endpoints VALUES((journey->>'id')::uuid,plan.trip_id,direction,NULL,NULL,hotel,NULL,feature);
                    ELSE
                        SELECT d.name,ST_AsGeoJSON(d.center::geometry)::jsonb INTO city,geometry FROM destination_stays v JOIN destination_places d USING(trip_id,city_id) WHERE v.stay_id=visit;
                        feature:=jsonb_build_object('type','Feature','id',direction,'geometry',geometry,'properties',jsonb_build_object('name',city));
                        INSERT INTO transportation_endpoints VALUES((journey->>'id')::uuid,plan.trip_id,direction,NULL,NULL,NULL,NULL,feature);
                    END IF;
                ELSE
                    source_place:=endpoint->>'placeId';
                    IF source_place LIKE '%:place:home' THEN
                        INSERT INTO transportation_endpoints VALUES((journey->>'id')::uuid,plan.trip_id,direction,NULL,NULL,NULL,owner,feature);
                    ELSE
                        source_airport_code:=substring(source_place FROM 'airport%3[Aa]([A-Z]{3})$');
                        INSERT INTO airports(code,name,city,country) VALUES(source_airport_code,source_airport_code,source_airport_code,'') ON CONFLICT(code) DO NOTHING;
                        SELECT id INTO airport FROM airports WHERE code=source_airport_code;
                        INSERT INTO transportation_endpoints VALUES((journey->>'id')::uuid,plan.trip_id,direction,NULL,airport,NULL,NULL,feature);
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;
DROP TRIGGER cleanup_travel_activity ON activities;
DROP TRIGGER cleanup_travel_visit ON destination_stays;
DROP FUNCTION cleanup_trip_travel_reference();
DROP TABLE trip_travel_plans;

CREATE FUNCTION snapshot_transportation_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE endpoint transportation_endpoints; snapshot jsonb;
BEGIN
    IF TG_TABLE_NAME='hotels' THEN
        DELETE FROM destination_stay_locations WHERE hotel_id=OLD.id;
    END IF;
    FOR endpoint IN SELECT e.* FROM transportation_endpoints e JOIN trips t ON t.id=e.trip_id WHERE
        (TG_TABLE_NAME='activities' AND e.activity_id=OLD.id)
        OR (TG_TABLE_NAME='airports' AND e.airport_id=OLD.id)
        OR (TG_TABLE_NAME='hotels' AND e.hotel_id=OLD.id)
        OR (TG_TABLE_NAME='users' AND e.home_user_id=OLD.id AND t.owner_user_id<>OLD.id)
        FOR UPDATE OF e
    LOOP
        snapshot:=transportation_endpoint_feature(endpoint);
        snapshot:=jsonb_set(snapshot,'{properties}',(snapshot->'properties')-'reference');
        IF NOT transportation_point_valid(snapshot) THEN
            RAISE EXCEPTION 'Resolve transportation % endpoint % before deleting its source: coordinates are unknown',endpoint.transportation_id,endpoint.role USING ERRCODE='23514';
        END IF;
        UPDATE transportation_endpoints SET activity_id=NULL,airport_id=NULL,hotel_id=NULL,home_user_id=NULL,feature=snapshot
        WHERE transportation_id=endpoint.transportation_id AND role=endpoint.role;
        UPDATE transportation SET version=version+1 WHERE id=endpoint.transportation_id;
    END LOOP;
    RETURN OLD;
END $$;
CREATE TRIGGER snapshot_transportation_activity BEFORE DELETE ON activities FOR EACH ROW EXECUTE FUNCTION snapshot_transportation_source();
CREATE TRIGGER snapshot_transportation_airport BEFORE DELETE ON airports FOR EACH ROW EXECUTE FUNCTION snapshot_transportation_source();
CREATE TRIGGER snapshot_transportation_hotel BEFORE DELETE ON hotels FOR EACH ROW EXECUTE FUNCTION snapshot_transportation_source();
CREATE TRIGGER snapshot_transportation_home BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION snapshot_transportation_source();

CREATE FUNCTION invalidate_transportation_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE moved boolean;
BEGIN
    IF TG_TABLE_NAME='users' THEN
        IF ROW(NEW.home_city_name,NEW.home_city_location) IS NOT DISTINCT FROM ROW(OLD.home_city_name,OLD.home_city_location) THEN RETURN NEW; END IF;
        moved:=NEW.home_city_location IS DISTINCT FROM OLD.home_city_location;
    ELSIF TG_TABLE_NAME='activities' THEN
        IF ROW(NEW.location,NEW.properties->>'name',NEW.properties->>'placeName',NEW.properties->>'address') IS NOT DISTINCT FROM ROW(OLD.location,OLD.properties->>'name',OLD.properties->>'placeName',OLD.properties->>'address') THEN RETURN NEW; END IF;
        moved:=NEW.location IS DISTINCT FROM OLD.location;
    ELSE
        IF to_jsonb(NEW)-'refreshed_at'-'version' IS NOT DISTINCT FROM to_jsonb(OLD)-'refreshed_at'-'version' THEN RETURN NEW; END IF;
        moved:=NEW.location IS DISTINCT FROM OLD.location;
    END IF;
    UPDATE transportation t SET version=version+1,route_stale=t.route_stale OR (moved AND jsonb_array_length(t.route_features)>0)
    WHERE t.id IN (SELECT e.transportation_id FROM transportation_endpoints e WHERE
        (TG_TABLE_NAME='activities' AND e.activity_id=NEW.id) OR
        (TG_TABLE_NAME='airports' AND e.airport_id=NEW.id) OR
        (TG_TABLE_NAME='hotels' AND e.hotel_id=NEW.id) OR
        (TG_TABLE_NAME='users' AND e.home_user_id=NEW.id));
    RETURN NEW;
END $$;
CREATE TRIGGER invalidate_transportation_activity AFTER UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION invalidate_transportation_source();
CREATE TRIGGER invalidate_transportation_airport AFTER UPDATE ON airports FOR EACH ROW EXECUTE FUNCTION invalidate_transportation_source();
CREATE TRIGGER invalidate_transportation_hotel AFTER UPDATE ON hotels FOR EACH ROW EXECUTE FUNCTION invalidate_transportation_source();
CREATE TRIGGER invalidate_transportation_home AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION invalidate_transportation_source();
CREATE TRIGGER transportation_revision AFTER INSERT OR UPDATE OR DELETE ON transportation FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
CREATE TRIGGER hotel_revision AFTER INSERT OR UPDATE OR DELETE ON hotels FOR EACH ROW EXECUTE FUNCTION bump_activity_planning_revision();
