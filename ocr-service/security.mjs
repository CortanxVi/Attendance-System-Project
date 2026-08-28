const FORBIDDEN_DATABASE_VARIABLES = [
  'SUPABASE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

export function assertIsolatedOcrEnvironment(environment = process.env) {
  const exposedNames = FORBIDDEN_DATABASE_VARIABLES.filter((name) => environment[name]);
  if (exposedNames.length > 0) {
    throw new Error(
      `OCR process received forbidden database/browser variables: ${exposedNames.join(', ')}`,
    );
  }
}
