-- Security-definer functions run as aven_function_owner and therefore need
-- EXECUTE on the context helpers they call. Runtime roles still cannot use
-- these helpers to gain privileges; they only read transaction-local settings.
GRANT EXECUTE ON FUNCTION app.current_principal_id() TO aven_function_owner;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO aven_function_owner;
GRANT EXECUTE ON FUNCTION app.is_worker() TO aven_function_owner;
