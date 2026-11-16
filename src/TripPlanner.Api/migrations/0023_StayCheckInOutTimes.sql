ALTER TABLE destination_stay_locations
    ADD COLUMN check_in_time time NOT NULL DEFAULT '16:00:00',
    ADD COLUMN check_out_time time NOT NULL DEFAULT '11:00:00';

CREATE OR REPLACE FUNCTION hotel_stay_feature(visit uuid,hotel uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('type','Feature','id',visit,'geometry',ST_AsGeoJSON(h.location::geometry)::jsonb,
        'properties',jsonb_build_object('name',h.name,'address',h.address,'hotelId',h.id,
            'checkInTime',s.check_in_time::text,'checkOutTime',s.check_out_time::text))
    FROM hotels h JOIN destination_stay_locations s ON s.hotel_id=h.id AND s.stay_id=visit
    WHERE h.id=hotel
$$;
