import { useRef, useState, type FormEvent } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Message } from 'primereact/message';
import { Password } from 'primereact/password';
import { Toast } from 'primereact/toast';
import { api } from '../api/client';
import FormField from './FormField';

export default function ChangePasswordDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const toast = useRef<Toast>(null);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/v1/auth/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      toast.current?.show({ severity: 'success', summary: 'Password changed', life: 2500 });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog visible={visible} onHide={onHide} header="Change Password" style={{ width: '26rem' }} breakpoints={{ '640px': '95vw' }}>
      <Toast ref={toast} />
      <form className="flex flex-column gap-3" onSubmit={submit}>
        {error && <Message severity="error" text={error} className="w-full justify-content-start" />}
        <FormField label="Current Password" htmlFor="pw-current">
          <Password
            inputId="pw-current"
            value={form.currentPassword}
            onChange={update('currentPassword')}
            feedback={false}
            toggleMask
            required
            className="w-full"
            inputClassName="w-full"
          />
        </FormField>
        <FormField label="New Password" htmlFor="pw-new">
          <Password
            inputId="pw-new"
            value={form.newPassword}
            onChange={update('newPassword')}
            toggleMask
            required
            minLength={8}
            className="w-full"
            inputClassName="w-full"
          />
        </FormField>
        <FormField label="Confirm New Password" htmlFor="pw-confirm">
          <Password
            inputId="pw-confirm"
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            feedback={false}
            toggleMask
            required
            className="w-full"
            inputClassName="w-full"
          />
        </FormField>
        <Button label="Change Password" type="submit" loading={submitting} className="mt-2" />
      </form>
    </Dialog>
  );
}
