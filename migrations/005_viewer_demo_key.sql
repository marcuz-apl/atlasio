-- Rename the viewer demo key to viewer-demo for existing deployments.
UPDATE access_profiles
SET demo_key = 'viewer-demo',
    key_prefix = left('viewer-demo', 8),
    rotated_at = now()
WHERE kind = 'demo' AND role = 'reader' AND demo_key = 'reader-demo';
