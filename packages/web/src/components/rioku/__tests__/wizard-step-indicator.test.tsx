import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WizardStepIndicator } from '../wizard-step-indicator'

describe('WizardStepIndicator', () => {
  const steps = ['Basics', 'Matching', 'Target', 'Policies & TLS', 'Review']

  it('renders all step labels', () => {
    render(<WizardStepIndicator steps={steps} currentStep={0} />)
    for (const label of steps) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks completed steps with a check icon', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={2} />)
    // Steps 0 and 1 should be done (have check marks)
    const doneSteps = container.querySelectorAll('[data-step-done="true"]')
    expect(doneSteps).toHaveLength(2)
  })

  it('highlights the active step', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={2} />)
    const activeStep = container.querySelector('[data-step-active="true"]')
    expect(activeStep).toBeInTheDocument()
    expect(activeStep?.textContent).toContain('3') // 0-indexed step 2 = display number 3
  })

  it('marks future steps as pending', () => {
    const { container } = render(<WizardStepIndicator steps={steps} currentStep={1} />)
    const pendingSteps = container.querySelectorAll('[data-step-pending="true"]')
    expect(pendingSteps.length).toBe(3) // steps 2, 3, 4
  })
})
