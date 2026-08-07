import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('supabase/migrations/202608080001_archive_cloud.sql'), 'utf8');
const appSource = readFileSync(resolve('src/App.tsx'), 'utf8');

describe('cloud data boundaries', () => {
  it('enforces database authorization and removes direct browser writes', () => {
    expect(migration).toContain('alter table public.archives enable row level security');
    expect(migration).toContain("visibility = 'public' and deleted_at is null");
    expect(migration).toContain('owner_id = (select auth.uid())');
    expect(migration).toContain('revoke all on public.archives from anon, authenticated');
    expect(migration).toContain('editor membership required');
  });

  it('never creates or mutates canonical geography tables', () => {
    expect(migration).not.toMatch(/create table public\.(?:countries|admin1|cities|geography)/i);
    expect(migration).not.toMatch(/update public\.(?:countries|admin1|cities|geography)/i);
  });

  it('does not persist display-only geography enrichment during refresh', () => {
    const refreshBody = appSource.slice(appSource.indexOf('const refresh = useCallback'), appSource.indexOf('const refreshPublicArchives'));
    expect(refreshBody).not.toContain('repository.update');
  });
});
