ALTER TABLE users
    DROP CONSTRAINT users_provider_supported,
    ADD CONSTRAINT users_provider_supported CHECK (
        provider = 'local' OR provider ~ '^(google|microsoft)(,(google|microsoft))*$'
    );
