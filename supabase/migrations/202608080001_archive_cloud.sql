begin;

create sequence if not exists public.archive_change_sequence;

create table public.editor_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'admin')),
  created_at timestamptz not null default now()
);

create table public.archives (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  place_id text not null check (length(place_id) between 1 and 300),
  place_snapshot jsonb not null check (jsonb_typeof(place_snapshot) = 'object'),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 20971520),
  revision bigint not null default 1 check (revision > 0),
  change_sequence bigint not null default nextval('public.archive_change_sequence'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index archives_owner_sequence_idx on public.archives(owner_id, change_sequence);
create index archives_public_updated_idx on public.archives(updated_at desc) where visibility = 'public' and deleted_at is null;
create index archives_place_idx on public.archives(place_id) where deleted_at is null;

create table public.processed_archive_mutations (
  mutation_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  archive_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index processed_archive_mutations_owner_created_idx
  on public.processed_archive_mutations(owner_id, created_at);

create or replace function public.touch_archive_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.change_sequence := nextval('public.archive_change_sequence');
  return new;
end;
$$;

create trigger archives_touch_change
before update on public.archives
for each row execute function public.touch_archive_change();

alter table public.editor_memberships enable row level security;
alter table public.archives enable row level security;
alter table public.processed_archive_mutations enable row level security;

create policy "members can read their membership"
on public.editor_memberships for select to authenticated
using (user_id = (select auth.uid()));

create policy "public or owner can read archives"
on public.archives for select to anon, authenticated
using (
  (visibility = 'public' and deleted_at is null)
  or owner_id = (select auth.uid())
);

revoke all on public.editor_memberships from anon, authenticated;
revoke all on public.archives from anon, authenticated;
revoke all on public.processed_archive_mutations from anon, authenticated;
grant select on public.editor_memberships to authenticated;
grant select on public.archives to anon, authenticated;

create or replace function public.apply_archive_mutation(
  p_mutation_id uuid,
  p_archive_id uuid,
  p_base_revision bigint,
  p_operation text,
  p_document jsonb,
  p_visibility text,
  p_place_id text,
  p_place_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.archives%rowtype;
  v_archive public.archives%rowtype;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.editor_memberships where user_id = v_user_id) then
    raise exception 'editor membership required' using errcode = '42501';
  end if;
  if p_operation not in ('upsert', 'delete') then raise exception 'unsupported archive operation'; end if;
  if p_base_revision < 0 then raise exception 'invalid base revision'; end if;

  select response into v_response
  from public.processed_archive_mutations
  where mutation_id = p_mutation_id and owner_id = v_user_id;
  if found then return v_response; end if;

  select * into v_existing from public.archives where id = p_archive_id for update;

  if p_operation = 'delete' then
    if not found then
      v_response := jsonb_build_object('status', 'applied');
    elsif v_existing.owner_id <> v_user_id then
      raise exception 'archive owner mismatch' using errcode = '42501';
    elsif v_existing.revision <> p_base_revision then
      return jsonb_build_object('status', 'conflict', 'archive', to_jsonb(v_existing));
    else
      update public.archives
      set deleted_at = now(), revision = revision + 1
      where id = p_archive_id
      returning * into v_archive;
      v_response := jsonb_build_object('status', 'applied', 'archive', to_jsonb(v_archive));
    end if;
  else
    if p_visibility not in ('private', 'public') then raise exception 'invalid visibility'; end if;
    if length(p_place_id) not between 1 and 300 then raise exception 'invalid place id'; end if;
    if jsonb_typeof(p_place_snapshot) <> 'object' then raise exception 'invalid place snapshot'; end if;
    if (p_place_snapshot->>'source') not in ('natural-earth', 'openstreetmap') then raise exception 'invalid place source'; end if;
    if (p_place_snapshot->>'kind') not in ('country', 'province', 'island', 'district', 'county', 'city', 'town', 'village') then raise exception 'invalid place kind'; end if;
    if (p_place_snapshot->>'latitude')::numeric not between -90 and 90 then raise exception 'invalid latitude'; end if;
    if (p_place_snapshot->>'longitude')::numeric not between -180 and 180 then raise exception 'invalid longitude'; end if;
    if jsonb_typeof(p_document) <> 'object' or octet_length(p_document::text) > 20971520 then raise exception 'invalid archive document'; end if;
    if nullif(trim(p_document->>'title'), '') is null or nullif(trim(p_document->>'locationName'), '') is null then
      raise exception 'archive title and location are required';
    end if;

    if not found then
      if p_base_revision <> 0 then return jsonb_build_object('status', 'conflict'); end if;
      insert into public.archives(id, owner_id, visibility, place_id, place_snapshot, document)
      values (p_archive_id, v_user_id, p_visibility, p_place_id, p_place_snapshot, p_document)
      returning * into v_archive;
    elsif v_existing.owner_id <> v_user_id then
      raise exception 'archive owner mismatch' using errcode = '42501';
    elsif v_existing.revision <> p_base_revision then
      return jsonb_build_object('status', 'conflict', 'archive', to_jsonb(v_existing));
    else
      update public.archives
      set visibility = p_visibility,
          place_id = p_place_id,
          place_snapshot = p_place_snapshot,
          document = p_document,
          revision = revision + 1,
          deleted_at = null
      where id = p_archive_id
      returning * into v_archive;
    end if;
    v_response := jsonb_build_object('status', 'applied', 'archive', to_jsonb(v_archive));
  end if;

  insert into public.processed_archive_mutations(mutation_id, owner_id, archive_id, response)
  values (p_mutation_id, v_user_id, p_archive_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_archive_mutation(uuid, uuid, bigint, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.apply_archive_mutation(uuid, uuid, bigint, text, jsonb, text, text, jsonb) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('archive-media', 'archive-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "owners upload archive media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'archive-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.editor_memberships where user_id = (select auth.uid()))
);

create policy "owners update archive media"
on storage.objects for update to authenticated
using (bucket_id = 'archive-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'archive-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owners delete archive media"
on storage.objects for delete to authenticated
using (bucket_id = 'archive-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owners or public readers view archive media"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'archive-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.archives archive
      where archive.id::text = (storage.foldername(name))[2]
        and archive.visibility = 'public'
        and archive.deleted_at is null
    )
  )
);

commit;
