-- Add leading-column indexes for public-schema foreign keys present in each
-- environment. Staging and production have some schema drift, so discover
-- current constraints at apply time and skip relations that are not present.
DO $migration$
DECLARE
  fk record;
  index_name text;
  column_list text;
BEGIN
  FOR fk IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           c.oid AS table_oid,
           con.conname AS constraint_name,
           con.conkey AS key_columns,
           array_agg(a.attname::text ORDER BY k.ord) AS column_names
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
    GROUP BY n.nspname, c.relname, c.oid, con.conname, con.conkey
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.table_oid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND i.indnkeyatts >= cardinality(fk.key_columns)
        AND ARRAY(
          SELECT pg_get_indexdef(i.indexrelid, position, true)
          FROM generate_series(1, cardinality(fk.key_columns)) AS pos(position)
          ORDER BY pos.position
        ) = fk.column_names
    ) THEN
      index_name := left('fk_' || fk.table_name, 40) || '_' ||
        substr(md5(fk.schema_name || '.' || fk.constraint_name), 1, 12);
      SELECT string_agg(format('%I', column_name), ', ' ORDER BY ord)
      INTO column_list
      FROM unnest(fk.column_names) WITH ORDINALITY AS cols(column_name, ord);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
        index_name, fk.schema_name, fk.table_name, column_list
      );
    END IF;
  END LOOP;
END
$migration$;
