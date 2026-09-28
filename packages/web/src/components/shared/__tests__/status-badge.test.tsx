/**
 * Tests for StatusBadge component.
 * Enum trạng thái hiển thị nhãn đã dịch (common:job_status.*), không phải giá trị thô.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { StatusBadge } from '../status-badge';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('StatusBadge', () => {
  it('renders the translated status label', () => {
    render(<StatusBadge status="complete" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByText('complete')).not.toBeInTheDocument();
  });

  it('applies green classes for complete status', () => {
    render(<StatusBadge status="complete" />);
    const badge = screen.getByText('Complete');
    expect(badge.className).toContain('green');
  });

  it('applies blue classes for running status', () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByText('Running');
    expect(badge.className).toContain('blue');
  });

  it('applies blue classes for generating status', () => {
    render(<StatusBadge status="generating" />);
    const badge = screen.getByText('Generating');
    expect(badge.className).toContain('blue');
  });

  it('applies blue classes for processing status (server export status)', () => {
    render(<StatusBadge status="processing" />);
    const badge = screen.getByText('Processing');
    expect(badge.className).toContain('blue');
  });

  it('applies yellow classes for pending status', () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText('Pending');
    expect(badge.className).toContain('yellow');
  });

  it('applies red classes for error status', () => {
    render(<StatusBadge status="error" />);
    const badge = screen.getByText('Error');
    expect(badge.className).toContain('red');
  });

  it('shows unknown status verbatim with gray fallback classes', () => {
    render(<StatusBadge status="unknown-xyz" />);
    const badge = screen.getByText('unknown-xyz');
    expect(badge.className).toContain('gray');
  });

  it('merges custom className prop', () => {
    render(<StatusBadge status="complete" className="my-custom-class" />);
    const badge = screen.getByText('Complete');
    expect(badge.className).toContain('my-custom-class');
  });

  it('renders as an inline span element', () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText('Pending');
    expect(badge.tagName).toBe('SPAN');
  });

  it('translates the label in other locales', async () => {
    await i18n.changeLanguage('vi');
    render(<StatusBadge status="complete" />);
    expect(screen.getByText('Hoàn tất')).toBeInTheDocument();
  });
});
