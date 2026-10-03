import { StepMark } from "@renderer/setup/step-mark";
import { useSetupSteps, type SetupStep } from "@renderer/setup/steps";

/** Home's list of unfinished setup steps; gone once every step is done. */
export function SetupChecklist() {
  const steps = useSetupSteps();

  if (steps.every((step) => step.isDone)) {
    return null;
  }

  return (
    <section aria-labelledby="setup-checklist-title" className="flex w-full gap-6 rounded-lg bg-surface-1 p-4">
      <div className="flex w-[220px] shrink-0 flex-col gap-1">
        <h2 id="setup-checklist-title" className="text-app-sm font-medium">
          Finish setting up
        </h2>
        <p className="text-app-xs text-ink-muted">You can look around now. Each step unlocks what needs it.</p>
      </div>
      <ul className="flex flex-1 flex-col">
        {steps.map((step, index) => (
          <ChecklistItem key={step.id} step={step} number={index + 1} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistItem({ step, number }: { step: SetupStep; number: number }) {
  return (
    <li className="flex min-h-10 items-center gap-3 border-b border-hairline-soft last:border-0">
      <StepMark number={number} isDone={step.isDone} />
      <span className="flex-1 text-app-sm">{step.title}</span>
      <ChecklistItemEnd step={step} />
    </li>
  );
}

function ChecklistItemEnd({ step }: { step: SetupStep }) {
  if (step.isDone) {
    return <span className="text-app-xs text-ink-muted">Done</span>;
  }

  return <step.ChecklistAction />;
}
