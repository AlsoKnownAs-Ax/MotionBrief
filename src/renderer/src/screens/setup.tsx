import { useEffect, useRef } from "react";
import { Button } from "@renderer/components/ui/button";
import { useNavigation } from "@renderer/navigation";
import { StepMark } from "@renderer/setup/step-mark";
import { useSetupSteps, type SetupStep } from "@renderer/setup/steps";

/** First-run setup. Never blocks: the user can leave at any time and finish from Home's checklist. */
export function Setup() {
  const steps = useSetupSteps();
  const openHome = useNavigation((state) => state.openHome);
  const isDone = steps.every((step) => step.isDone);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-app-display">Set up MotionBrief</h1>
          <p className="text-app-body text-ink-muted">
            Finish these before your first video. You can skip ahead at any time and finish from Home.
          </p>
        </div>

        {steps.map((step, index) => (
          <SetupStepSection key={step.id} step={step} number={index + 1} />
        ))}

        <div className="flex items-center justify-end gap-3 border-t border-hairline-soft pt-5">
          {isDone ? null : <span className="text-app-xs text-ink-muted">Unfinished steps stay on Home’s checklist.</span>}
          <Button variant={continueVariant(isDone)} onClick={openHome}>
            Continue to Home
          </Button>
        </div>
      </div>
    </main>
  );
}

function continueVariant(isDone: boolean) {
  if (isDone) {
    return "primary";
  }

  return "tertiary";
}

function SetupStepSection({ step, number }: { step: SetupStep; number: number }) {
  const focusedStep = useNavigation((state) => state.focusedStep);
  const section = useRef<HTMLElement>(null);
  const isFocused = focusedStep === step.id;

  useEffect(() => {
    if (isFocused) {
      section.current?.scrollIntoView({ block: "start" });
      section.current?.focus();
    }
  }, [isFocused]);

  return (
    <section ref={section} tabIndex={-1} aria-labelledby={`${step.id}-title`} className="flex gap-4 outline-none">
      <StepMark number={number} isDone={step.isDone} />
      <div className="flex flex-1 flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 id={`${step.id}-title`} className="text-app-title">
            {step.title}
          </h2>
          <p className="text-app-sm text-ink-muted">{step.description}</p>
        </div>
        <step.Panel />
      </div>
    </section>
  );
}
