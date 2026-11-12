-- Development-only rows inserted between 0032 and 0033 by db:verify.
BEGIN;
INSERT INTO public.principals(id,type,display_name) VALUES
 ('99000000-0000-4000-8000-000000000001','user','开发升级用户一'),
 ('99000000-0000-4000-8000-000000000002','user','开发升级用户二');
INSERT INTO public.users(id) VALUES
 ('99000000-0000-4000-8000-000000000001'),('99000000-0000-4000-8000-000000000002');
INSERT INTO public.connection_previews(id,actor_user_id,recipient_user_id,memory_item_ids,manifest,grant_expires_at,expires_at)
 VALUES('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',
 '99000000-0000-4000-8000-000000000002',ARRAY['99000000-0000-4000-8000-000000000007']::uuid[],
 '[{"value":"开发升级正文"}]',clock_timestamp()+interval '7 days',clock_timestamp()+interval '10 minutes');
INSERT INTO public.consent_grants(id,grantor_principal_id,grantee_principal_id,purpose,expires_at,connection_invitation_id)
 VALUES('99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000001',
 '99000000-0000-4000-8000-000000000002','connection_invitation',clock_timestamp()+interval '7 days','99000000-0000-4000-8000-000000000005');
INSERT INTO public.connection_invitations(id,sender_user_id,recipient_user_id,preview_id,idempotency_key,grant_id,expires_at)
 VALUES('99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000001',
 '99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003',
 '99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000004',clock_timestamp()+interval '7 days');
INSERT INTO public.consent_grant_items(id,grant_id,source_type,source_id,field_key,status,value_snapshot)
 VALUES('99000000-0000-4000-8000-000000000008','99000000-0000-4000-8000-000000000004',
 'memory_item','99000000-0000-4000-8000-000000000007','content','stale','"开发升级正文"'),
 ('99000000-0000-4000-8000-000000000009','99000000-0000-4000-8000-000000000004',
 'memory_item','99000000-0000-4000-8000-000000000010','content','active','"开发升级正文"');
COMMIT;
