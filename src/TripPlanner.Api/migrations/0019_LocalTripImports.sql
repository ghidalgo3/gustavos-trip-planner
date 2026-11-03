-- Intentionally no trip foreign key: the receipt survives trip deletion.
CREATE TABLE trip_imports (
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transfer_id uuid NOT NULL,
    source_trip_id uuid NOT NULL UNIQUE,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, transfer_id)
);
