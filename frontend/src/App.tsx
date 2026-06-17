import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useCompanyStore } from "@/store/companyStore";

import DashboardPage from "./pages/DashboardPage";
import LeadGenerationPage from "./pages/LeadGenerationPage";
import MetaFormsPage from "./pages/MetaFormsPage";
import CustomFormsPage from "./pages/CustomFormsPage";
import CustomFormDetailPage from "./pages/CustomFormDetailPage";
import LeadManagementOverviewPage from "./pages/LeadManagementOverviewPage";
import LeadsPage from "./pages/LeadsPage";
import ContactsPage from "./pages/ContactsPage";
import ContactGroupPage from "./pages/ContactGroupPage";
import AutomationOverviewPage from "./pages/AutomationOverviewPage";
import AutomationPage from "./pages/AutomationPage";
import AutomationTemplatesPage from "./pages/AutomationTemplatesPage";
import WorkflowEditorPage from "./pages/WorkflowEditorPage";
import WaPersonalTemplateEditorPage from "./pages/WaPersonalTemplateEditorPage";
import WaPersonalOverviewPage from "./pages/WaPersonalOverviewPage";
import WorkflowAnalyticsPage from "./pages/WorkflowAnalyticsPage";
import InboxPage from "./pages/InboxPage";
import InboxOverviewPage from "./pages/InboxOverviewPage";
import FieldsPage from "./pages/FieldsPage";
import StaffPage from "./pages/StaffPage";
import SettingsPage from "./pages/SettingsPage";
import CompanyDetailsPage from "./pages/CompanyDetailsPage";
import BrandingPage from "./pages/BrandingPage";
import SecurityPage from "./pages/SecurityPage";
import NotificationsPage from "./pages/NotificationsPage";
import AssignmentRulesPage from "./pages/AssignmentRulesPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import LoginPage from "./pages/LoginPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ActivatePage from "./pages/ActivatePage";
import PublicFormPage from "./pages/PublicFormPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import SuperAdminDashboardPage from "./pages/SuperAdminDashboardPage";
import CreateBusinessPage from "./pages/CreateBusinessPage";
import FollowUpsPage from "./pages/FollowUpsPage";
import CalendarPage from "./pages/CalendarPage";
import CalendarEditPage from "./pages/CalendarEditPage";
import PublicBookingPage from "./pages/PublicBookingPage";
import NotFound from "./pages/NotFound";
import PincodeRoutingPage from "./pages/PincodeRoutingPage";
import WhatsAppDevicesPage from "./pages/WhatsAppDevicesPage";
import WhatsAppSingleSendPage from "./pages/WhatsAppSingleSendPage";
import ReportsPage from "./pages/ReportsPage";
import CallsPage from "./pages/CallsPage";

const queryClient = new QueryClient();

// Calls is gated by the per-tenant Superfone feature flag.
const CallsRoute = () => {
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  return superfoneEnabled ? <CallsPage /> : <Navigate to="/dashboard" replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/activate" element={<ActivatePage />} />
          <Route path="/f/:slug" element={<PublicFormPage />} />
          <Route path="/book/:slug" element={<PublicBookingPage />} />
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

            {/* Calendar */}
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/calendar/edit/:id" element={<CalendarEditPage />} />

            <Route path="/calls" element={<CallsRoute />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/inbox/overview" element={<InboxOverviewPage />} />
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/staff" element={<StaffPage />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/company" element={<CompanyDetailsPage />} />
            <Route path="/settings/branding" element={<BrandingPage />} />
            <Route path="/settings/security" element={<SecurityPage />} />
            <Route path="/settings/notifications" element={<NotificationsPage />} />
            <Route path="/settings/assignment-rules" element={<AssignmentRulesPage />} />
            <Route path="/settings/integrations" element={<IntegrationsPage />} />
            <Route path="/settings/integrations/wa-personal" element={<WaPersonalOverviewPage />} />
            <Route path="/automation/pincode-routing" element={<PincodeRoutingPage />} />

            {/* Super Admin */}
            <Route path="/admin" element={<SuperAdminPage />} />
            <Route path="/admin/dashboard" element={<SuperAdminDashboardPage />} />
            <Route path="/admin/create" element={<CreateBusinessPage />} />

            {/* WA Personal template editor — inside AppLayout (sidebar visible) */}
            <Route path="/automation/templates/wa-personal/new" element={<WaPersonalTemplateEditorPage />} />
            <Route path="/automation/templates/wa-personal/:id" element={<WaPersonalTemplateEditorPage />} />
          </Route>

          {/* Full-screen editors — outside AppLayout but still protected */}
          <Route path="/automation/editor/:id" element={<WorkflowEditorPage />} />
          <Route path="/automation/analytics/:id" element={<WorkflowAnalyticsPage />} />
          </Route>{/* closes AuthGuard */}

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
