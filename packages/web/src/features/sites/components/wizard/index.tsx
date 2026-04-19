/**
 * <SiteCreateWizard> — 5-step Mantine Stepper create flow.
 *
 * A single `useForm` instance owns all values. Each step validates only its
 * own fields when the user clicks Next (via `form.validateField`).
 *
 * Steps:
 *   1. Hostname  — name, domain
 *   2. Upstream  — existing service OR new upstream (protocol/host/port)
 *   3. TLS       — auto / manual (+PEMs) / off
 *   4. Policies  — basic_auth, rate_limit_preset, redirect_rules
 *   5. Review    — summary + Create button
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Stack,
  Stepper,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { createSite } from '../../api';
import { createSiteWizardSchema } from '../../schemas';
import type { SiteWizardInput } from '../../types';
import type { Site } from '@/api/resources/types';
import { StepHostname } from './step-hostname';
import { StepUpstream } from './step-upstream';
import { StepTls } from './step-tls';
import { StepPolicies } from './step-policies';
import { StepReview } from './step-review';

export type WizardStep = 0 | 1 | 2 | 3 | 4;

export type RedirectStatus = 301 | 302 | 307 | 308;

export interface WizardFormValues {
  // Step 1
  name: string;
  domain: string;
  // Step 2
  upstream_mode: 'existing_service' | 'new_upstream';
  upstream_service_id: string;
  upstream_protocol: 'http' | 'https' | 'grpc';
  upstream_host: string;
  upstream_port: number | '';
  // Step 3
  tls_mode: 'auto' | 'manual' | 'off';
  tls_manual_cert_pem: string;
  tls_manual_key_pem: string;
  // Step 4
  basic_auth_enabled: boolean;
  rate_limit_preset: 'none' | 'lenient' | 'standard' | 'strict';
  redirect_rules: { from: string; to: string; status: RedirectStatus }[];
}

interface SiteCreateWizardProps {
  tenantId: string;
  onSuccess: (site: Site) => void;
  onCancel: () => void;
}

export function SiteCreateWizard({
  tenantId,
  onSuccess,
  onCancel,
}: SiteCreateWizardProps) {
  const [active, setActive] = useState<WizardStep>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allServices = useMockStore((s) => s.services);
  const serviceOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const svc of Object.values(allServices)) {
      if (svc.tenant_id === tenantId) {
        out.push({ value: svc.id, label: svc.name });
      }
    }
    return out;
  }, [allServices, tenantId]);

  const form = useForm<WizardFormValues>({
    initialValues: {
      name: '',
      domain: '',
      upstream_mode: 'existing_service',
      upstream_service_id: '',
      upstream_protocol: 'http',
      upstream_host: '',
      upstream_port: '',
      tls_mode: 'auto',
      tls_manual_cert_pem: '',
      tls_manual_key_pem: '',
      basic_auth_enabled: false,
      rate_limit_preset: 'none',
      redirect_rules: [],
    },
    validate: schemaResolver(createSiteWizardSchema, { sync: true }),
  });

  function validateStep(step: WizardStep): boolean {
    const errors: Record<string, string> = {};
    // Step 0 — hostname
    if (step === 0) {
      if (form.values.name.trim() === '') {
        errors.name = 'Name is required';
      }
      const domainRegex =
        /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
      if (!domainRegex.test(form.values.domain.trim())) {
        errors.domain = 'Invalid domain';
      }
    }
    if (step === 1) {
      if (
        form.values.upstream_mode === 'existing_service' &&
        form.values.upstream_service_id === ''
      ) {
        errors.upstream_service_id = 'Select a service';
      }
      if (form.values.upstream_mode === 'new_upstream') {
        if (form.values.upstream_host.trim() === '') {
          errors.upstream_host = 'Host is required';
        }
      }
    }
    if (step === 2 && form.values.tls_mode === 'manual') {
      if (form.values.tls_manual_cert_pem.trim() === '') {
        errors.tls_manual_cert_pem = 'Certificate PEM is required';
      }
      if (form.values.tls_manual_key_pem.trim() === '') {
        errors.tls_manual_key_pem = 'Private key PEM is required';
      }
    }
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return false;
    }
    return true;
  }

  function handleNext() {
    if (!validateStep(active)) return;
    setActive((s) => (s + 1) as WizardStep);
  }

  function handleBack() {
    setActive((s) => (s === 0 ? 0 : ((s - 1) as WizardStep)));
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const v = form.values;
      const payload: SiteWizardInput = {
        name: v.name.trim(),
        domain: v.domain.trim(),
        upstream_mode: v.upstream_mode,
        tls_mode: v.tls_mode,
        basic_auth_enabled: v.basic_auth_enabled,
        rate_limit_preset: v.rate_limit_preset,
        redirect_rules: v.redirect_rules,
        ...(v.upstream_mode === 'existing_service'
          ? { upstream_service_id: v.upstream_service_id }
          : {
              upstream_protocol: v.upstream_protocol,
              upstream_host: v.upstream_host.trim(),
              ...(typeof v.upstream_port === 'number'
                ? { upstream_port: v.upstream_port }
                : {}),
            }),
        ...(v.tls_mode === 'manual'
          ? {
              tls_manual_cert_pem: v.tls_manual_cert_pem,
              tls_manual_key_pem: v.tls_manual_key_pem,
            }
          : {}),
      };
      const result = await createSite(tenantId, payload);
      notify.success('Site created', `${result.site.domain} is ready.`);
      onSuccess(result.site);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create site';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      <Stepper
        active={active}
        onStepClick={(idx) => {
          // Allow going back to any prior step; forward only if validated.
          if (idx < active) {
            setActive(idx as WizardStep);
          } else if (idx > active) {
            // Validate all steps up to idx
            let ok = true;
            for (let s: WizardStep = active; s < idx; s = (s + 1) as WizardStep) {
              if (!validateStep(s)) {
                ok = false;
                break;
              }
            }
            if (ok) setActive(idx as WizardStep);
          }
        }}
        size="sm"
      >
        <Stepper.Step label="Hostname" description="Name + domain">
          <StepHostname form={form} />
        </Stepper.Step>
        <Stepper.Step label="Upstream" description="Service or raw host">
          <StepUpstream form={form} serviceOptions={serviceOptions} />
        </Stepper.Step>
        <Stepper.Step label="TLS" description="Cert mode">
          <StepTls form={form} />
        </Stepper.Step>
        <Stepper.Step label="Policies" description="Auth + limits">
          <StepPolicies form={form} />
        </Stepper.Step>
        <Stepper.Completed>
          <StepReview form={form} serviceOptions={serviceOptions} />
        </Stepper.Completed>
      </Stepper>

      <Group justify="space-between">
        <Button
          variant="default"
          onClick={active === 0 ? onCancel : handleBack}
          disabled={submitting}
        >
          {active === 0 ? 'Cancel' : 'Back'}
        </Button>
        {active < 4 ? (
          <Button onClick={handleNext}>Next</Button>
        ) : (
          <Button
            loading={submitting}
            onClick={() => void handleCreate()}
            data-testid="wizard-create-site"
          >
            Create site
          </Button>
        )}
      </Group>
    </Stack>
  );
}
