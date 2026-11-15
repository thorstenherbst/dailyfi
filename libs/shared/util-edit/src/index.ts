export * from './lib/edit-session';
// Bewusst ohne `ROUTER_PAGE_ID_KEY`/`routerPageId`: private Angular-API, nur
// intern (und im Spec) benutzt.
export {
  LEAVE_WITHOUT_ASKING,
  type LeaveIntent,
  type LeavesWithUnsavedCheck,
  RouteLeave,
  unsavedChangesGuard,
} from './lib/route-leave';
