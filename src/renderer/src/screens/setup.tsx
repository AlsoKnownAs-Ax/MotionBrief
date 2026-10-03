import { Button } from "@renderer/components/ui/button";
import { StepMark, useSetupSteps, type SetupStep } from "@renderer/setup/steps";
import { leaveSetup } from "./navigation";

function continueVariant(allDone: boolean) {
  if (allDone) {
    return "primary";
  }

  return "secondary";
}

function StepCard({ step, number }: { step: SetupStep; number: number }) {
  return (
    <section aria-labelledby={`setup-${step.id}`} className="flex gap-4 rounded-lg border border-hairline-soft bg-surface-1 p-6">
      <StepMark number={number} done={step.done} />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 id={`setup-${step.id}`} className="text-app-title">
            {step.title}
          </h2>
          <p className="max-w-[58ch] text-app-sm text-ink-muted">{step.description}</p>
        </div>
        {step.panel}
      </div>
    </section>
  );
}

/** First-run setup. Every step keeps going in the background, so the user can leave at any time. */
export function Setup() {
  const steps = useSetupSteps();
  const allDone = steps.every((step) => step.done);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 pt-14 pb-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-app-display">Set up MotionBrief</h1>
          <p className="max-w-[56ch] text-app-body text-ink-muted">
            A few things before your first video. They keep going in the background, so you can skip ahead and finish from Home.
          </p>
        </div>
        {steps.map((step, index) => (
          <StepCard key={step.id} step={step} number={index + 1} />
        ))}
        <div className="flex items-center justify-end gap-3.5">
          {allDone ? null : <span className="text-app-xs text-ink-muted">Unfinished steps stay on Home’s checklist.</span>}
          <Button variant={continueVariant(allDone)} onClick={leaveSetup}>
            Continue to Home
          </Button>
        </div>
      </div>
    </main>
  );
}
