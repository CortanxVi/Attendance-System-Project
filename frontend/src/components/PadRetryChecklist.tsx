import { PAD_RETRY_CHECKLIST, PAD_RETRY_TITLE } from '../utils/padFailure';

/** Short, non-blocking advice shown above the retry button after a PAD refusal. */
export default function PadRetryChecklist() {
  return (
    <div className="mx-auto mb-4 max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-950">
      <p className="mb-1 font-bold">{PAD_RETRY_TITLE}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {PAD_RETRY_CHECKLIST.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
