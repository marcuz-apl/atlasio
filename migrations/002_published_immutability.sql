CREATE OR REPLACE FUNCTION forbid_published_batch_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'Published import batches are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER published_batches_immutable
    BEFORE UPDATE OR DELETE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION forbid_published_batch_change();

CREATE OR REPLACE FUNCTION forbid_published_file_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM import_batches WHERE id = OLD.batch_id AND status = 'published') THEN
        RAISE EXCEPTION 'Published source files are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER published_files_immutable
    BEFORE UPDATE OR DELETE ON file_assets
    FOR EACH ROW EXECUTE FUNCTION forbid_published_file_change();
