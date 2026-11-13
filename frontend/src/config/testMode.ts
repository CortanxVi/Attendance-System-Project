/**
 * Build-time switch for the QR-free test UI (Preview builds of a test branch).
 *
 * The matching Backend endpoints exist only when the Backend itself runs in
 * ATTENDANCE_TEST_MODE for listed test courses. Never set VITE_TEST_MODE in a
 * production release: scripts/build_release_bundle.sh and
 * scripts/production_preflight.py both refuse it.
 */
export const TEST_MODE = import.meta.env.VITE_TEST_MODE === '1';
