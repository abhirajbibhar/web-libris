import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from 'primereact/avatar';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Dialog } from 'primereact/dialog';
import { Divider } from 'primereact/divider';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Password } from 'primereact/password';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { api } from '../api/client';
import type { Library, Permissions, Shelf, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { tip } from '../utils/tooltip';
import FormField from '../components/FormField';
import ListRow from '../components/ListRow';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import { useTheme } from '../theme/ThemeContext';
import { queryKeys, useLibraries, useShelves, useUsers } from '../hooks/useApi';

function useToast() {
  const toast = useRef<Toast>(null);
  const node = <Toast ref={toast} />;
  return { toast, node };
}

const FORM_MESSAGE_CLASS = 'w-full justify-content-start';

/* ------------------------------ libraries ------------------------------- */

function LibrariesSection() {
  const { toast, node } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: libraries } = useLibraries();
  const canManage = Boolean(user?.permissions.canManageLibrary || user?.permissions.admin);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Library | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const rescanCovers = async () => {
    setRescanning(true);
    try {
      const result = await api.post<{ covers: number; fixed: number }>('/api/v1/books/covers/rescan');
      await queryClient.invalidateQueries({ queryKey: queryKeys.books });
      toast.current?.show({
        severity: 'success',
        summary: result.fixed > 0 ? `Re-linked ${result.fixed} ${result.fixed === 1 ? 'cover' : 'covers'}` : 'Covers are up to date',
        detail: `${result.covers} cover ${result.covers === 1 ? 'file' : 'files'} found in storage`,
        life: 3500
      });
    } catch (err) {
      toast.current?.show({ severity: 'error', summary: err instanceof Error ? err.message : 'Could not scan covers', life: 4000 });
    } finally {
      setRescanning(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (library: Library) => {
    setEditing(library);
    setName(library.name);
    setError(null);
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editing) {
        await api.put(`/api/v1/libraries/${editing.id}`, { name });
        toast.current?.show({ severity: 'success', summary: 'Library updated', life: 2000 });
      } else {
        await api.post('/api/v1/libraries', { name });
        toast.current?.show({ severity: 'success', summary: 'Library created', life: 2000 });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraries });
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const remove = (library: Library) => {
    confirmDialog({
      message: `Delete library "${library.name}" and ALL books inside it?`,
      header: 'Delete Library',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await api.delete(`/api/v1/libraries/${library.id}`);
          await queryClient.invalidateQueries({ queryKey: queryKeys.libraries });
          await queryClient.invalidateQueries({ queryKey: queryKeys.books });
          toast.current?.show({ severity: 'success', summary: 'Library deleted', life: 2000 });
        } catch (err) {
          toast.current?.show({
            severity: 'error',
            summary: 'Delete failed',
            detail: err instanceof Error ? err.message : undefined,
            life: 3000
          });
        }
      }
    });
  };

  return (
    <div className="flex flex-column gap-3">
      {node}
      <ConfirmDialog />
      <SectionCard
        title="Libraries"
        icon="pi-folder"
        action={canManage && <Button label="New Library" icon="pi pi-plus" onClick={openCreate} />}
      >
        <div className="flex flex-column">
          {(libraries ?? []).length === 0 && <p className="m-0 text-color-secondary">No libraries yet.</p>}
          {(libraries ?? []).map(library => (
            <ListRow
              key={library.id}
              icon="pi-folder"
              title={library.name}
              subtitle={`${library.bookCount ?? 0} ${library.bookCount === 1 ? 'book' : 'books'}`}
              actions={
                canManage ? (
                  <>
                    <Button icon="pi pi-pencil" text severity="secondary" aria-label={`Edit ${library.name}`} onClick={() => openEdit(library)} {...tip('Edit')} />
                    <Button icon="pi pi-trash" text severity="danger" aria-label={`Delete ${library.name}`} onClick={() => remove(library)} {...tip('Delete')} />
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      </SectionCard>

      {canManage && (
        <SectionCard title="Maintenance" icon="pi-wrench">
          <p className="mt-0 mb-3 text-sm text-color-secondary">
            Book covers missing even though the image is in storage? Re-scan links every cover file in the bucket back to its book.
          </p>
          <Button label="Re-scan covers" icon="pi pi-refresh" outlined loading={rescanning} onClick={() => void rescanCovers()} className="self-start" />
        </SectionCard>
      )}

      <Dialog
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        header={editing ? 'Edit Library' : 'New Library'}
        style={{ width: '22rem' }}
        breakpoints={{ '640px': '95vw' }}
      >
        <form onSubmit={save} className="flex flex-column gap-3">
          {error && <Message severity="error" text={error} className={FORM_MESSAGE_CLASS} />}
          <FormField label="Name" htmlFor="library-name">
            <InputText id="library-name" value={name} onChange={event => setName(event.target.value)} required autoFocus />
          </FormField>
          <Button label="Save" type="submit" className="mt-2" />
        </form>
      </Dialog>
    </div>
  );
}

/* -------------------------------- shelves ------------------------------- */

function ShelvesSection() {
  const { toast, node } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: shelves } = useShelves();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Shelf | null>(null);
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setIsPublic(false);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (shelf: Shelf) => {
    setEditing(shelf);
    setName(shelf.name);
    setIsPublic(Boolean(shelf.publicShelf));
    setError(null);
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editing) {
        await api.put(`/api/v1/shelves/${editing.id}`, { name, publicShelf: isPublic });
        toast.current?.show({ severity: 'success', summary: 'Shelf updated', life: 2000 });
      } else {
        await api.post('/api/v1/shelves', { name, publicShelf: isPublic });
        toast.current?.show({ severity: 'success', summary: 'Shelf created', life: 2000 });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.shelves });
      await queryClient.invalidateQueries({ queryKey: queryKeys.books });
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const remove = (shelf: Shelf) => {
    confirmDialog({
      message: `Delete shelf "${shelf.name}"? Books stay in the library.`,
      header: 'Delete Shelf',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await api.delete(`/api/v1/shelves/${shelf.id}`);
          await queryClient.invalidateQueries({ queryKey: queryKeys.shelves });
          await queryClient.invalidateQueries({ queryKey: queryKeys.books });
          toast.current?.show({ severity: 'success', summary: 'Shelf deleted', life: 2000 });
        } catch (err) {
          toast.current?.show({
            severity: 'error',
            summary: 'Delete failed',
            detail: err instanceof Error ? err.message : undefined,
            life: 3000
          });
        }
      }
    });
  };

  return (
    <div className="flex flex-column gap-3">
      {node}
      <ConfirmDialog />
      <SectionCard
        title="Shelves"
        icon="pi-bookmark"
        action={<Button label="New Shelf" icon="pi pi-plus" onClick={openCreate} />}
      >
        <div className="flex flex-column">
          {(shelves ?? []).length === 0 && <p className="m-0 text-color-secondary">No shelves yet.</p>}
          {(shelves ?? []).map(shelf => (
            <ListRow
              key={shelf.id}
              icon="pi-bookmark"
              title={shelf.name}
              subtitle={`${shelf.bookCount ?? 0} ${shelf.bookCount === 1 ? 'book' : 'books'}`}
              meta={<Tag value={shelf.publicShelf ? 'Public' : 'Private'} severity={shelf.publicShelf ? 'info' : 'secondary'} />}
              actions={
                <>
                  <Button icon="pi pi-pencil" text severity="secondary" aria-label={`Edit ${shelf.name}`} onClick={() => openEdit(shelf)} {...tip('Edit')} />
                  <Button
                    icon="pi pi-trash"
                    text
                    severity="danger"
                    aria-label={`Delete ${shelf.name}`}
                    onClick={() => remove(shelf)}
                    {...tip('Delete')}
                    disabled={Boolean(shelf.userId && shelf.userId !== user?.id && !user?.permissions.admin)}
                  />
                </>
              }
            />
          ))}
        </div>
      </SectionCard>

      <Dialog
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        header={editing ? 'Edit Shelf' : 'New Shelf'}
        style={{ width: '22rem' }}
        breakpoints={{ '640px': '95vw' }}
      >
        <form onSubmit={save} className="flex flex-column gap-3">
          {error && <Message severity="error" text={error} className={FORM_MESSAGE_CLASS} />}
          <FormField label="Name" htmlFor="shelf-name">
            <InputText id="shelf-name" value={name} onChange={event => setName(event.target.value)} required autoFocus />
          </FormField>
          <div className="flex align-items-center gap-2">
            <Checkbox checked={isPublic} onChange={event => setIsPublic(Boolean(event.checked))} inputId="shelf-public" />
            <label htmlFor="shelf-public" className="cursor-pointer">
              Visible to all users
            </label>
          </div>
          <Button label="Save" type="submit" className="mt-2" />
        </form>
      </Dialog>
    </div>
  );
}

/* --------------------------------- users -------------------------------- */

const PERMISSION_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'canUpload', label: 'Can upload' },
  { key: 'canDownload', label: 'Can download' },
  { key: 'canDeleteBook', label: 'Can delete books' },
  { key: 'canEditMetadata', label: 'Can edit metadata' },
  { key: 'canManageLibrary', label: 'Can manage libraries' },
  { key: 'canManageUsers', label: 'Can manage users' }
];

const defaultPermissions = (): Permissions => ({
  admin: false,
  canUpload: true,
  canDownload: true,
  canDeleteBook: false,
  canEditMetadata: true,
  canManageLibrary: false,
  canManageUsers: false
});

function UsersSection() {
  const { toast, node } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: users } = useUsers(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '' });
  const [permissions, setPermissions] = useState<Permissions>(defaultPermissions());
  const [error, setError] = useState<string | null>(null);
  const [passwordReset, setPasswordReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  if (!user?.permissions.admin) {
    return (
      <div className="flex flex-column gap-3">
        <Message severity="warn" text="Admin access is required to manage users." />
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setForm({ username: '', name: '', email: '', password: '' });
    setPermissions(defaultPermissions());
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (target: User) => {
    setEditing(target);
    setForm({ username: target.username, name: target.name, email: target.email, password: '' });
    setPermissions({ ...target.permissions });
    setError(null);
    setDialogOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editing) {
        await api.put(`/api/v1/users/${editing.id}`, { name: form.name, email: form.email, permissions });
        toast.current?.show({ severity: 'success', summary: 'User updated', life: 2000 });
      } else {
        await api.post('/api/v1/users', { ...form, permissions });
        toast.current?.show({ severity: 'success', summary: 'User created', life: 2000 });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordReset) return;
    try {
      await api.post(`/api/v1/users/${passwordReset.id}/password`, { password: newPassword });
      toast.current?.show({ severity: 'success', summary: 'Password reset', life: 2000 });
      setPasswordReset(null);
      setNewPassword('');
    } catch (err) {
      toast.current?.show({
        severity: 'error',
        summary: 'Reset failed',
        detail: err instanceof Error ? err.message : undefined,
        life: 3000
      });
    }
  };

  const remove = (target: User) => {
    confirmDialog({
      message: `Delete user "${target.username}"?`,
      header: 'Delete User',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await api.delete(`/api/v1/users/${target.id}`);
          await queryClient.invalidateQueries({ queryKey: queryKeys.users });
          toast.current?.show({ severity: 'success', summary: 'User deleted', life: 2000 });
        } catch (err) {
          toast.current?.show({
            severity: 'error',
            summary: 'Delete failed',
            detail: err instanceof Error ? err.message : undefined,
            life: 3000
          });
        }
      }
    });
  };

  return (
    <div className="flex flex-column gap-3">
      {node}
      <ConfirmDialog />
      <SectionCard
        title="Users"
        icon="pi-users"
        action={<Button label="New User" icon="pi pi-plus" onClick={openCreate} />}
      >
        <div className="flex flex-column">
          {(users ?? []).length === 0 && <p className="m-0 text-color-secondary">No users.</p>}
          {(users ?? []).map(target => (
            <ListRow
              key={target.id}
              leading={<Avatar label={(target.name || target.username).charAt(0).toUpperCase()} shape="circle" className="flex-shrink-0" />}
              title={target.name || target.username}
              subtitle={`@${target.username} · ${target.email}`}
              meta={
                target.permissions.admin ? (
                  <Tag value="Admin" severity="warning" />
                ) : PERMISSION_LABELS.filter(label => target.permissions[label.key]).length > 0 ? (
                  PERMISSION_LABELS.filter(label => target.permissions[label.key]).map(label => (
                    <Tag key={label.key} value={label.label} severity="secondary" />
                  ))
                ) : (
                  <span className="text-xs text-color-secondary">No permissions</span>
                )
              }
              actions={
                <>
                  <Button icon="pi pi-pencil" text severity="secondary" aria-label={`Edit ${target.username}`} onClick={() => openEdit(target)} {...tip('Edit')} />
                  <Button
                    icon="pi pi-key"
                    text
                    severity="secondary"
                    aria-label={`Reset password for ${target.username}`}
                    onClick={() => {
                      setPasswordReset(target);
                      setNewPassword('');
                    }}
                    {...tip('Reset password')}
                  />
                  <Button
                    icon="pi pi-trash"
                    text
                    severity="danger"
                    aria-label={`Delete ${target.username}`}
                    onClick={() => remove(target)}
                    {...tip('Delete')}
                    disabled={target.id === user.id}
                  />
                </>
              }
            />
          ))}
        </div>
      </SectionCard>

      <Dialog
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        header={editing ? `Edit ${editing.username}` : 'New User'}
        style={{ width: '26rem' }}
        breakpoints={{ '640px': '95vw' }}
      >
        <form onSubmit={save} className="flex flex-column gap-3">
          {error && <Message severity="error" text={error} className={FORM_MESSAGE_CLASS} />}
          {!editing && (
            <FormField label="Username" htmlFor="user-username">
              <InputText
                id="user-username"
                value={form.username}
                onChange={event => setForm(current => ({ ...current, username: event.target.value }))}
                required
              />
            </FormField>
          )}
          <FormField label="Name" htmlFor="user-name">
            <InputText
              id="user-name"
              value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
              required
            />
          </FormField>
          <FormField label="Email" htmlFor="user-email">
            <InputText
              id="user-email"
              type="email"
              value={form.email}
              onChange={event => setForm(current => ({ ...current, email: event.target.value }))}
              required
            />
          </FormField>
          {!editing && (
            <FormField label="Password" htmlFor="user-password">
              <Password
                inputId="user-password"
                value={form.password}
                onChange={event => setForm(current => ({ ...current, password: event.target.value }))}
                feedback={false}
                toggleMask
                required
                minLength={8}
                className="w-full"
                inputClassName="w-full"
              />
            </FormField>
          )}
          <Divider className="my-1" />
          <span className="font-medium text-sm">Permissions</span>
          <div className="grid">
            {PERMISSION_LABELS.map(permission => (
              <div key={permission.key} className="col-12 sm:col-6 flex align-items-center gap-2 py-1">
                <Checkbox
                  checked={permissions[permission.key]}
                  onChange={event =>
                    setPermissions(current => ({ ...current, [permission.key]: Boolean(event.checked) }))
                  }
                  inputId={`perm-${permission.key}`}
                />
                <label htmlFor={`perm-${permission.key}`} className="cursor-pointer text-sm">
                  {permission.label}
                </label>
              </div>
            ))}
          </div>
          <Button label="Save" type="submit" className="mt-2" />
        </form>
      </Dialog>

      <Dialog
        visible={Boolean(passwordReset)}
        onHide={() => setPasswordReset(null)}
        header={passwordReset ? `Reset password for ${passwordReset.username}` : ''}
        style={{ width: '22rem' }}
        breakpoints={{ '640px': '95vw' }}
      >
        <form onSubmit={resetPassword} className="flex flex-column gap-3">
          <FormField label="New Password" htmlFor="reset-password">
            <Password
              inputId="reset-password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              feedback={false}
              toggleMask
              required
              minLength={8}
              autoFocus
              className="w-full"
              inputClassName="w-full"
            />
          </FormField>
          <Button label="Reset Password" type="submit" className="mt-2" />
        </form>
      </Dialog>
    </div>
  );
}

/* -------------------------------- account ------------------------------- */

function AccountSection() {
  const toast = useRef<Toast>(null);
  const { user, logoutAll } = useAuth();
  const { mode, setMode } = useTheme();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [key]: event.target.value }));

  const submitPassword = async (event: FormEvent) => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSubmitting(false);
    }
  };

  const clearSession = async () => {
    try {
      await logoutAll();
    } catch {
      // worst case the tokens are still cleared below
    }
    window.location.href = '/login';
  };

  return (
    <div className="flex flex-column gap-3">
      <Toast ref={toast} />
      <SectionCard title="Profile" icon="pi-user">
        <div className="flex align-items-center gap-3">
          <Avatar label={(user?.name || user?.username || '?').charAt(0).toUpperCase()} shape="circle" size="xlarge" className="flex-shrink-0" />
          <div className="flex flex-column gap-1 min-w-0">
            <span className="text-lg font-semibold">{user?.name || user?.username}</span>
            <span className="text-sm text-color-secondary">@{user?.username}</span>
            <span className="text-sm text-color-secondary" style={{ overflowWrap: 'anywhere' }}>{user?.email}</span>
            {user?.permissions.admin && (
              <div className="mt-1">
                <Tag value="Admin" severity="warning" />
              </div>
            )}
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Appearance" icon="pi-palette">
        <p className="mt-0 mb-3 text-sm text-color-secondary">Also available from the user menu in the top bar.</p>
        <SelectButton
          value={mode}
          options={[
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' }
          ]}
          allowEmpty={false}
          onChange={event => setMode(event.value as 'light' | 'dark')}
          aria-label="Theme"
        />
      </SectionCard>
      <SectionCard title="Change password" icon="pi-key">
        <form onSubmit={submitPassword} className="flex flex-column gap-3">
          <FormField label="Current Password" htmlFor="settings-current-password">
            <Password
              inputId="settings-current-password"
              value={form.currentPassword}
              onChange={update('currentPassword')}
              feedback={false}
              toggleMask
              required
              className="w-full"
              inputClassName="w-full"
            />
          </FormField>
          <FormField label="New Password" htmlFor="settings-new-password">
            <Password
              inputId="settings-new-password"
              value={form.newPassword}
              onChange={update('newPassword')}
              feedback={false}
              toggleMask
              required
              minLength={8}
              className="w-full"
              inputClassName="w-full"
            />
          </FormField>
          <FormField label="Confirm New Password" htmlFor="settings-confirm-password">
            <Password
              inputId="settings-confirm-password"
              value={form.confirmPassword}
              onChange={update('confirmPassword')}
              feedback={false}
              toggleMask
              required
              className="w-full"
              inputClassName="w-full"
            />
          </FormField>
          {error && <Message severity="error" text={error} className={FORM_MESSAGE_CLASS} />}
          <Button label="Change Password" type="submit" loading={submitting} className="mt-2 self-start" />
        </form>
      </SectionCard>
      <SectionCard title="Sessions" icon="pi-shield">
        <p className="mt-0 mb-3 text-sm text-color-secondary">Sign out of this and every other device where you are logged in.</p>
        <Button label="Logout everywhere" icon="pi pi-power-off" severity="danger" outlined onClick={clearSession} className="self-start" />
      </SectionCard>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

type SettingsSectionKey = 'libraries' | 'shelves' | 'users' | 'account';

const SECTION_ICONS: Record<SettingsSectionKey, string> = {
  libraries: 'pi pi-folder',
  shelves: 'pi pi-bookmark',
  users: 'pi pi-users',
  account: 'pi pi-user'
};

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.permissions.admin);
  const [active, setActive] = useState<SettingsSectionKey>('libraries');

  const items: { key: SettingsSectionKey; label: string; description: string }[] = [
    { key: 'libraries', label: 'Libraries', description: 'Create, rename and delete libraries.' },
    { key: 'shelves', label: 'Shelves', description: 'Organize books into public or private shelves.' },
    ...(isAdmin
      ? [{ key: 'users' as const, label: 'Users', description: 'Manage accounts and permissions.' }]
      : []),
    { key: 'account', label: 'Account', description: 'Your profile, appearance and security.' }
  ];

  const activeItem = items.find(item => item.key === active) ?? items[0];

  return (
    <div className="grid" style={{ maxWidth: '72rem' }}>
      {/* Section navigation: horizontal chips on small screens, vertical rail on large. */}
      <div className="col-12 lg:col-3">
        <div className="flex lg:flex-column gap-2 overflow-auto pb-1 lg:pb-0" role="tablist" aria-label="Settings sections">
          {items.map(item => {
            const selected = item.key === activeItem.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(item.key)}
                className={`flex align-items-center gap-3 border-round cursor-pointer text-left transition-colors ${
                  selected ? 'surface-card shadow-1 text-primary' : 'surface-hover text-color'
                }`}
                style={{ padding: '0.75rem 1rem', border: '1px solid var(--surface-border)', minWidth: '11rem' }}
              >
                <i className={`pi ${SECTION_ICONS[item.key]} ${selected ? 'text-primary' : 'text-color-secondary'}`} />
                <span className="font-medium white-space-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="col-12 lg:col-9">
        <PageHeader title={activeItem.label} subtitle={activeItem.description} />
        <div className="mt-3">
          {activeItem.key === 'libraries' && <LibrariesSection />}
          {activeItem.key === 'shelves' && <ShelvesSection />}
          {activeItem.key === 'users' && <UsersSection />}
          {activeItem.key === 'account' && <AccountSection />}
        </div>
      </div>
    </div>
  );
}
