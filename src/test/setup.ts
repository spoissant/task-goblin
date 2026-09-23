// Set env before any imports
process.env.DATABASE_URL = ":memory:";
// Keep dev stack tests away from the real boot log.
process.env.DEV_STACK_LOG = `${import.meta.dir}/../../logs/dev-stack.test.log`;
