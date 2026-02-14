insert into public.doctors (name, spid, room_label, is_active)
values
  ('Dr. Aye Chan', 'MED', 'Bldg A Room 101', true),
  ('Dr. Su Mon', 'ENT', 'Bldg B Room 204', true),
  ('Dr. Nyan Lin', 'ORTHO', 'Bldg C Room 303', true),
  ('Dr. Ei Ei', 'CARDIO', 'Bldg A Room 210', true),
  ('Dr. Myat Thu', 'NEURO', 'Bldg D Room 118', true)
on conflict do nothing;
