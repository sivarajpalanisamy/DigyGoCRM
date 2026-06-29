import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useCompanyStore } from "@/store/companyStore";

// Pages are code-split (React.lazy) so the initial bundle stays small — each route
// loads its own chunk on demand instead of shipping all ~60 pages up front.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const LeadGenerationPage = lazy(() => import("./pages/LeadGenerationPage"));
const MetaFormsPage = lazy(() => import("./pages/MetaFormsPage"));
const CustomFormsPage = lazy(() => import("./pages/CustomFormsPage"));
const CustomFormDetailPage = lazy(() => import("./pages/CustomFormDetailPage"));
const LeadManagementOverviewPage = lazy(() => import("./pages/LeadManagementOverviewPage"));
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const ContactGroupPage = lazy(() => import("./pages/ContactGroupPage"));
const AutomationOverviewPage = lazy(() => import("./pages/AutomationOverviewPage"));
const AutomationPage = lazy(() => import("./pages/AutomationPage"));
const AutomationTemplatesPage = lazy(() => import("./pages/AutomationTemplatesPage"));
const WorkflowEditorPage = lazy(() => import("./pages/WorkflowEditorPage"));
const WaPersonalTemplateEditorPage = lazy(() => import("./pages/WaPersonalTemplateEditorPage"));
const WABATemplateEditorPage = lazy(() => import("./pages/WABATemplateEditorPage"));
const WaPersonalOverviewPage = lazy(() => import("./pages/WaPersonalOverviewPage"));
const WorkflowAnalyticsPage = lazy(() => import("./pages/WorkflowAnalyticsPage"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const InboxOverviewPage = lazy(() => import("./pages/InboxOverviewPage"));
const FieldsPage = lazy(() => import("./pages/FieldsPage"));
const StaffPage = lazy(() => import("./pages/StaffPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CompanyDetailsPage = lazy(() => import("./pages/CompanyDetailsPage"));
const BrandingPage = lazy(() => import("./pages/BrandingPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const DevicesPage = lazy(() => import("./pages/DevicesPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const AssignmentRulesPage = lazy(() => import("./pages/AssignmentRulesPage"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const AcceptInvitePage = lazy(() => import("./pages/AcceptInvitePage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ActivatePage = lazy(() => import("./pages/ActivatePage"));
const PublicFormPage = lazy(() => import("./pages/PublicFormPage"));
const SuperAdminPage = lazy(() => import("./pages/SuperAdminPage"));
const SuperAdminDashboardPage = lazy(() => import("./pages/SuperAdminDashboardPage"));
const CreateBusinessPage = lazy(() => import("./pages/CreateBusinessPage"));
const SuperAdminTeamPage = lazy(() => import("./pages/SuperAdminTeamPage"));
const FollowUpsPage = lazy(() => import("./pages/FollowUpsPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const CalendarEditPage = lazy(() => import("./pages/CalendarEditPage"));
const PublicBookingPage = lazy(() => import("./pages/PublicBookingPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PincodeRoutingPage = lazy(() => import("./pages/PincodeRoutingPage"));
const WhatsAppDevicesPage = lazy(() => import("./pages/WhatsAppDevicesPage"));
const WhatsAppSingleSendPage = lazy(() => import("./pages/WhatsAppSingleSendPage"));
const WhatsAppSetupPage = lazy(() => import("./pages/WhatsAppSetupPage"));
const WABABroadcastPage = lazy(() => import("./pages/WABABroadcastPage"));
const WABASingleSendPage = lazy(() => import("./pages/WABASingleSendPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const CallsPage = lazy(() => import("./pages/CallsPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const LandingPagesPage = lazy(() => import("./pages/LandingPagesPage"));
const LandingPageBuilderPage = lazy(() => import("./pages/LandingPageBuilderPage"));
const PublicLandingPage = lazy(() => import("./pages/PublicLandingPage"));

const queryClient = new QueryClient();

// Lightweight fallback shown while a route chunk loads.
const PageFallback = () => (
  <div className="flex items-center justify-center h-[60vh] w-full">
    <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
  </div>
);

// Superfone calls page is gated by the per-tenant Superfone feature flag.
const SuperfoneCallsRoute = () => {
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  return superfoneEnabled ? <CallsPage source="superfone" /> : <Navigate to="/dashboard" replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/activate" element={<ActivatePage />} />
          <Route path="/f/:slug" element={<PublicFormPage />} />
          <Route path="/book/:slug" element={<PublicBookingPage />} />
          <Route path="/p/:slug" element={<PublicLandingPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* App routes */}
          <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/reports"   element={<ReportsPage />} />

            {/* Lead Generation */}
            <Route path="/lead-generation" element={<LeadGenerationPage />} />
            <Route path="/lead-generation/meta-forms" element={<MetaFormsPage />} />
            <Route path="/lead-generation/custom-forms" element={<CustomFormsPage />} />
            <Route path="/lead-generation/custom-forms/:id" element={<CustomFormDetailPage />} />
            <Route path="/lead-generation/landing-pages" element={<LandingPagesPage />} />

            {/* Lead Management */}
            <Route path="/lead-management" element={<LeadManagementOverviewPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/lead-management/followups" element={<FollowUpsPage />} />
            <Route path="/lead-management/contacts" element={<ContactsPage />} />
            <Route path="/lead-management/contact-groups" element={<ContactGroupPage />} />

            {/* Automation */}
            <Route path="/automation" element={<AutomationOverviewPage />} />
            <Route path="/automation/workflows" element={<AutomationPage />} />
            <Route path="/automation/templates" element={<AutomationTemplatesPage />} />
            <Route path="/automation/devices" element={<WhatsAppDevicesPage />} />
            <Route path="/automation/wa-send" element={<WhatsAppSingleSendPage />} />
            <Route path="/automation/waba" element={<WhatsAppSetupPage />} />
            <Route path="/automation/waba-templates" element={<AutomationTemplatesPage />} />
            <Route path="/automation/waba-broadcast" element={<WABABroadcastPage />} />
            <Route path="/automation/waba-send" element={<WABASingleSendPage />} />

            {/* Calendar */}
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/calendar/edit/:id" element={<CalendarEditPage />} />

            <Route path="/calls" element={<CallsPage source="mobile" />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/superfone-calls" element={<SuperfoneCallsRoute />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/inbox/overview" element={<InboxOverviewPage />} />
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/staff" element={<StaffPage />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/company" element={<CompanyDetailsPage />} />
            <Route path="/settings/branding" element={<BrandingPage />} />
            <Route path="/settings/security" element={<SecurityPage />} />
            <Route path="/settings/devices" element={<DevicesPage />} />
            <Route path="/settings/notifications" element={<NotificationsPage />} />
            <Route path="/settings/assignment-rules" element={<AssignmentRulesPage />} />
            <Route path="/settings/integrations" element={<IntegrationsPage />} />
            <Route path="/settings/integrations/wa-personal" element={<WaPersonalOverviewPage />} />
            <Route path="/automation/pincode-routing" element={<PincodeRoutingPage />} />

            {/* Super Admin */}
            <Route path="/admin" element={<SuperAdminPage />} />
            <Route path="/admin/dashboard" element={<SuperAdminDashboardPage />} />
            <Route path="/admin/create" element={<CreateBusinessPage />} />
            <Route path="/admin/team" element={<SuperAdminTeamPage />} />

            {/* Template editors — inside AppLayout (sidebar visible) */}
            <Route path="/automation/templates/wa-personal/new" element={<WaPersonalTemplateEditorPage />} />
            <Route path="/automation/templates/wa-personal/:id" element={<WaPersonalTemplateEditorPage />} />
            <Route path="/automation/templates/waba/new" element={<WABATemplateEditorPage />} />
            <Route path="/automation/templates/waba/:id" element={<WABATemplateEditorPage />} />
          </Route>

          {/* Full-screen editors — outside AppLayout but still protected */}
          <Route path="/automation/editor/:id" element={<WorkflowEditorPage />} />
          <Route path="/automation/analytics/:id" element={<WorkflowAnalyticsPage />} />
          <Route path="/lead-generation/landing-pages/builder" element={<LandingPageBuilderPage />} />
          </Route>{/* closes AuthGuard */}

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
