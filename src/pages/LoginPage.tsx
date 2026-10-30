import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from '~/router/compat';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Password } from 'primereact/password';
import { useAuth } from '../auth/AuthContext';
import FormField from '../components/FormField';
import { useSetupStatus } from '../hooks/useApi';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, login } = useAuth();
  const { data: setupStatus } = useSetupStatus();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sessionExpired = searchParams.get('reason') === 'session_expired';

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const setupRequired = setupStatus?.setupRequired ?? false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (setupRequired && !username && !password) {
      setError('No admin account exists. Set ADMIN_USER and ADMIN_PASSWORD secrets in the Cloudflare dashboard, then sign in.');
      return;
    }
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex align-items-center justify-content-center min-h-screen p-3 surface-ground text-color">
      <Card
        className="w-full shadow-4"
        style={{ maxWidth: '26rem' }}
        title={
          <span className="flex align-items-center gap-2">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            Web Libris
          </span>
        }
        subTitle="Sign in to your library."
      >
        <form className="flex flex-column gap-3" onSubmit={submit}>
          {sessionExpired && (
            <Message severity="warn" text="Your session expired, please sign in again." className="w-full justify-content-start" />
          )}
          {error && <Message severity="error" text={error} className="w-full justify-content-start" />}
          <FormField label="Username" htmlFor="login-username">
            <InputText
              id="login-username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="login-password">
            <Password
              inputId="login-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              feedback={false}
              toggleMask
              required
              autoComplete="current-password"
              className="w-full"
              inputClassName="w-full"
            />
          </FormField>
          <Button label="Sign In" icon="pi pi-sign-in" type="submit" loading={submitting} className="mt-2" />
        </form>
      </Card>
    </div>
  );
}
