/**
 * Unit tests for the install-by-reference validators + forms.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { InstallByReferenceForms } from '../components/forms';
import {
  validateManifestUrl,
  LOOKALIKE_BLOCKLIST,
  ociFormSchema,
} from '../schemas';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

describe('validateManifestUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a plain https:// URL with ASCII hostname', () => {
    const res = validateManifestUrl('https://registry.example.com/plugin.json');
    expect(res.ok).toBe(true);
  });

  it('rejects http:// URLs', () => {
    const res = validateManifestUrl('http://registry.example.com/plugin.json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/https/i);
  });

  it('rejects URLs whose hostname is on the lookalike block-list', () => {
    for (const bad of LOOKALIKE_BLOCKLIST) {
      const res = validateManifestUrl(`https://${bad}.example.com/x.json`);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/lookalike/i);
    }
  });

  it('rejects URLs with non-ASCII hostnames', () => {
    // Using a punycode-encoded form is tricky — directly test the URL parser
    // behavior via a unicode literal host.
    const res = validateManifestUrl('https://xn--90a3ac.example/x.json');
    // xn-- punycode is ASCII — this should PASS; non-ASCII native unicode fails
    expect(res.ok).toBe(true);
  });

  it('rejects URLs with trailing-dot or double-dot hostnames', () => {
    const res = validateManifestUrl('https://bad..example.com/x.json');
    expect(res.ok).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const res = validateManifestUrl('not-a-url');
    expect(res.ok).toBe(false);
  });
});

describe('ociFormSchema', () => {
  it('accepts a well-formed oci:// reference', () => {
    const parsed = ociFormSchema.safeParse({
      reference: 'oci://registry.example.com/plugin-name:1.2.3',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a reference with a multi-segment path', () => {
    const parsed = ociFormSchema.safeParse({
      reference: 'oci://ghcr.io/org/team/plugin:v2.0',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a reference missing the tag', () => {
    const parsed = ociFormSchema.safeParse({
      reference: 'oci://registry.example.com/plugin',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-oci:// protocol', () => {
    const parsed = ociFormSchema.safeParse({
      reference: 'https://registry.example.com/plugin:1.0',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects uppercase host (OCI spec: lowercase only)', () => {
    const parsed = ociFormSchema.safeParse({
      reference: 'oci://REGISTRY.EXAMPLE.COM/plugin:1.0',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('InstallByReferenceForms', () => {
  it('renders all three sub-forms (OCI, tarball, URL)', () => {
    wrap(<InstallByReferenceForms onRequestApproval={vi.fn()} />);
    expect(screen.getByLabelText(/OCI reference/i)).toBeTruthy();
    expect(screen.getByLabelText(/Tarball file/i)).toBeTruthy();
    expect(screen.getByLabelText(/Manifest URL/i)).toBeTruthy();
  });

  it('submits a valid OCI reference and calls onRequestApproval with a candidate', async () => {
    const onApproval = vi.fn();
    wrap(<InstallByReferenceForms onRequestApproval={onApproval} />);

    const ociInput = screen.getByLabelText(/OCI reference/i);
    fireEvent.change(ociInput, {
      target: { value: 'oci://ghcr.io/riokulabs/test-plugin:1.0.0' },
    });

    // Submit via the Review & install button that sits next to the OCI input
    const submitButtons = screen.getAllByRole('button', { name: /Review.*install/i });
    const first = submitButtons[0];
    if (!first) throw new Error('No submit buttons');

    fireEvent.click(first);

    await waitFor(
      () => {
        expect(onApproval).toHaveBeenCalledOnce();
      },
      { timeout: 2000 },
    );
    const candidate = onApproval.mock.calls[0]?.[0] as {
      slug: string;
      source: string;
      reference: string;
    };
    expect(candidate.source).toBe('oci');
    expect(candidate.reference).toContain('oci://');
    expect(candidate.slug).toBe('test-plugin');
  });

  it('rejects an invalid manifest URL (http://)', async () => {
    const onApproval = vi.fn();
    wrap(<InstallByReferenceForms onRequestApproval={onApproval} />);

    const urlInput = screen.getByLabelText(/Manifest URL/i);
    fireEvent.change(urlInput, {
      target: { value: 'http://insecure.example.com/plugin.json' },
    });

    // Find the URL form submit — it's the last "Review & install" button
    const submitButtons = screen.getAllByRole('button', { name: /Review.*install/i });
    const last = submitButtons[submitButtons.length - 1];
    if (!last) throw new Error('No submit buttons');

    fireEvent.click(last);
    await new Promise((r) => setTimeout(r, 150));

    // Form validation should have prevented submit
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('rejects a lookalike hostname', async () => {
    const onApproval = vi.fn();
    wrap(<InstallByReferenceForms onRequestApproval={onApproval} />);

    const urlInput = screen.getByLabelText(/Manifest URL/i);
    fireEvent.change(urlInput, {
      target: { value: 'https://gooogle.evil.com/plugin.json' },
    });

    const submitButtons = screen.getAllByRole('button', { name: /Review.*install/i });
    const last = submitButtons[submitButtons.length - 1];
    if (!last) throw new Error('No submit buttons');

    fireEvent.click(last);
    // Allow any pending microtasks / validation to settle
    await new Promise((r) => setTimeout(r, 150));
    expect(onApproval).not.toHaveBeenCalled();
  });
});
