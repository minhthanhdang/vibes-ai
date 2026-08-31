-- Carries data statements, under the policy of
-- 20260823170000_many_conversations (orchestrator-tool-reference §VII.8).
--
-- `cropBox Int[]` and `editAspect String` become one `edit` Json list of ops, so
-- a version can record a turn, a flip and a grade as well as a box. Prisma's own
-- diff would emit the add and the two drops as one statement and lose every
-- existing crop. So the add comes first, the backfill in between, and the drops
-- last. Every identifier below is Prisma's own, verbatim.
--
-- `edit` is born NOT NULL with a default, so there is no nullable-then-SET NOT
-- NULL dance: `[]` already means "no edit" exactly as `cropBox Int[]` default
-- `[]` did. `array_length` of a null or empty array is null, so an original keeps
-- the default rather than being filed as a crop of nothing.
--
-- No CHECK: it would restate `editOps` in SQL and then drift from it. No index:
-- nothing filters on this column.
--
-- All of it runs inside the one transaction `migrate deploy` wraps a migration in.

-- AlterTable
ALTER TABLE "Reference" ADD COLUMN     "edit" JSONB NOT NULL DEFAULT '[]';

-- Backfill
UPDATE "Reference"
SET "edit" = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'op', 'crop', 'box', to_jsonb("cropBox"), 'shape', NULLIF("editAspect", ''))))
WHERE array_length("cropBox", 1) = 4;

-- AlterTable
ALTER TABLE "Reference" DROP COLUMN "cropBox",
DROP COLUMN "editAspect";
