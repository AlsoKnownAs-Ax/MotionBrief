import { Button } from "@renderer/components/ui/button";
import { useNavigation } from "@renderer/navigation";
import { StepMark } from "./step-mark";
import { useSetupSteps, type SetupStep } from "./steps";

function ChecklistItem({ step, number }: { step: SetupStep; number: number }) {
  return (
    <li className="flex min-h-control items-center gap-2.5">
      <StepMark number={number} done={step.done} size="sm" />
      <span className="w-40 shrink-0 text-app-sm">{step.label}</span>
      <div className="min-w-0 flex-1">
        {step.done ? <span className="float-right text-app-xs text-ink-muted">Done</span> : step.summary}
      </div>
    </li>
  );
}

/** Home's list of setup steps, shown until every step is done. */
export function SetupChecklist() {
  const steps = useSetupSteps();
  const openSetup = useNavigation((state) => state.openSetup);

  if (!steps.some((step) => step.done === false)) {
    return null;
  }

  return (
    <section aria-label="Finish setting up" className="flex w-full max-w-3xl gap-7 rounded-lg border border-hairline-soft bg-surface-1 px-5 py-4">
      <div className="flex w-[200px] shrink-0 flex-col items-start gap-1">
        <h2 className="text-app-sm font-medium">Finish setting up</h2>
        <p className="text-app-xs text-ink-muted">You can look around now. Transcribing and generating wait for these steps.</p>
        <Button variant="ghost" size="sm" className="-ml-[11px]" onClick={() => openSetup()}>
          Open setup
        </Button>
      </div>
      <ol className="flex min-w-0 flex-1 flex-col gap-3">
        {steps.map((step, index) => (
          <ChecklistItem key={step.id} step={step} number={index + 1} />
        ))}
      </ol>
    </section>
  );
}
