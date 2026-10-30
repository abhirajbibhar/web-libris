import { useRef, useState } from 'react';
import { useNavigate } from '~/router/compat';
import { Button } from 'primereact/button';
import { InputSwitch } from 'primereact/inputswitch';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { Toolbar } from 'primereact/toolbar';
import { useAuth } from '../auth/AuthContext';
import UploadDialog from '../components/UploadDialog';
import { useTheme } from '../theme/ThemeContext';
import { FLAT_BAR_CLASS, TOPBAR_HEIGHT } from './constants';

export default function Topbar({
  isMobile,
  onMenuToggle
}: {
  isMobile: boolean;
  onMenuToggle?: () => void;
}) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, setMode } = useTheme();
  const menuRef = useRef<Menu>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const userMenuItems: MenuItem[] = [
    { label: 'Settings', icon: 'pi pi-cog', command: () => navigate('/settings') },
    {
      // Custom row: a switch inside the menu. Clicks are stopped here so the
      // popup stays open while toggling and the page can be seen changing.
      template: () => (
        <div
          className="p-menuitem-content"
          onClick={event => {
            event.stopPropagation();
            setMode(isDark ? 'light' : 'dark');
          }}
        >
          <div className="p-menuitem-link cursor-pointer">
            <span className={`p-menuitem-icon pi ${isDark ? 'pi-moon' : 'pi-sun'}`} />
            <span className="p-menuitem-text flex-1">Dark mode</span>
            <span onClick={event => event.stopPropagation()} className="flex">
              <InputSwitch
                inputId="theme-switch"
                aria-label="Dark mode"
                checked={isDark}
                onChange={event => setMode(event.value ? 'dark' : 'light')}
              />
            </span>
          </div>
        </div>
      )
    },
    { separator: true },
    { label: 'Logout', icon: 'pi pi-sign-out', command: () => void logout() }
  ];

  return (
    <>
      <Toolbar
        className={`${FLAT_BAR_CLASS} px-3 py-0 flex-nowrap flex-shrink-0`}
        style={{ height: TOPBAR_HEIGHT }}
        start={
          <Button
            icon="pi pi-bars"
            text
            severity="secondary"
            onClick={onMenuToggle}
            aria-label={isMobile ? 'Open menu' : 'Toggle sidebar'}
          />
        }
        end={
          <div className="flex align-items-center gap-2">
            {user?.permissions.canUpload && (
              <Button
                icon="pi pi-upload"
                label={isMobile ? undefined : 'Upload'}
                aria-label="Upload books"
                onClick={() => setUploadOpen(true)}
              />
            )}
            <Menu model={userMenuItems} ref={menuRef} popup popupAlignment="right" style={{ width: '14rem' }} />
            <Button
              icon="pi pi-user"
              text
              severity="secondary"
              onClick={event => menuRef.current?.toggle(event)}
              aria-label="User menu"
              aria-haspopup
            />
          </div>
        }
      />
      <UploadDialog visible={uploadOpen} onHide={() => setUploadOpen(false)} />
    </>
  );
}
