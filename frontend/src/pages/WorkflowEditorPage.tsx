import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft, Zap, Plus, X, ChevronDown, Check, Search,
  Play, Settings, Save, AlertCircle, Trash2, Clock, Pencil,
  ClipboardList, FolderOpen, User, Calendar, Inbox, MessageCircle,
  Banknote, GraduationCap, Terminal, ZoomIn, ZoomOut, Lock, Maximize2,
  FolderPlus, Bot, UserCheck, CalendarCheck, Star, ArrowLeftRight, Tag,
  Mail, Smartphone, Bell, Timer, GitBranch, CalendarPlus, FileText,
  Camera, ThumbsUp, Globe, Code, MessageSquare,
  Package, ClipboardPen, Infinity as InfinityIcon, Network, History,
  FilePlus, UserPlus, UserCog, BookMarked, CalendarX, CalendarOff,
  ListChecks, Code2, CalendarDays, CalendarClock, CalendarRange, ArrowRight,
  UserMinus, UserX, FolderX, PlayCircle, PauseCircle, LogOut, SquareMinus, Users, UserRoundCog,
  RotateCcw, ChevronRight, Copy, Power, Info, ExternalLink, Loader2, TrendingUp, MapPin, RefreshCw,
  Paperclip, Upload, Eye, Edit2, Radio, PhoneCall, PhoneMissed, AlertTriangle,
} from 'lucide-react';
import type { ElementType } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import { api, getAccessToken, BASE, ApiError } from '@/lib/api';
import type { WFNode, WFRecord } from './AutomationPage';
import { useCrmStore } from '@/store/crmStore';

// ── Trigger Categories ─────────────────────────────────────────────────────────
interface TriggerItem { id: string; label: string; Icon: ElementType; sourceId: string }
interface TriggerCategory { id: string; label: string; items: TriggerItem[] }

const TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    id: 'forms', label: 'Forms',
    items: [
      { id: 'opt_in_form', label: 'Custom Form Submitted', Icon: FileText, sourceId: 'forms' },
      { id: 'meta_form', label: 'Meta Form Submitted', Icon: InfinityIcon, sourceId: 'forms' },
      { id: 'product_enquired', label: 'Product Enquired', Icon: Package, sourceId: 'forms' },
    ],
  },
  {
    id: 'crm', label: 'CRM',
    items: [
      { id: 'stage_changed', label: 'Stage Changed', Icon: ArrowLeftRight, sourceId: 'crm' },
      { id: 'follow_up', label: 'Follow Up', Icon: History, sourceId: 'crm' },
      { id: 'notes_added', label: 'Notes Added', Icon: FilePlus, sourceId: 'crm' },
      { id: 'contact_group_added', label: 'Added to Contact Group', Icon: Users, sourceId: 'crm' },
    ],
  },
  {
    id: 'contact', label: 'Contact',
    items: [
      { id: 'contact_created', label: 'Contact Source', Icon: UserPlus, sourceId: 'contact' },
      { id: 'contact_updated', label: 'Contact Updated', Icon: UserCog, sourceId: 'contact' },
      { id: 'contact_tagged', label: 'Contact Tagged', Icon: BookMarked, sourceId: 'contact' },
    ],
  },
  {
    id: 'calendar', label: 'Calendar',
    items: [
      { id: 'calendar_form_submitted', label: 'Calendar Form Submitted', Icon: CalendarPlus, sourceId: 'calendar' },
      { id: 'appointment_booked', label: 'Appointment Booked', Icon: CalendarCheck, sourceId: 'calendar' },
      { id: 'appointment_cancelled', label: 'Appointment Cancelled', Icon: CalendarX, sourceId: 'calendar' },
      { id: 'appointment_rescheduled', label: 'Appointment Rescheduled', Icon: CalendarClock, sourceId: 'calendar' },
      { id: 'appointment_noshow', label: 'No-Show Appointment', Icon: CalendarOff, sourceId: 'calendar' },
      { id: 'appointment_showup', label: 'Show Up Appointment', Icon: ListChecks, sourceId: 'calendar' },
    ],
  },
  {
    id: 'api', label: 'External API',
    items: [
      { id: 'webhook_inbound', label: 'API 1.0', Icon: Code2, sourceId: 'api' },
    ],
  },
  {
    id: 'schedule', label: 'Schedule',
    items: [
      { id: 'specific_date', label: 'Specific date', Icon: CalendarDays, sourceId: 'schedule' },
      { id: 'weekly_recurring', label: 'Weekly recurring', Icon: CalendarRange, sourceId: 'schedule' },
      { id: 'monthly_recurring', label: 'Monthly recurring', Icon: CalendarRange, sourceId: 'schedule' },
      { id: 'event_date', label: 'Event Date', Icon: CalendarClock, sourceId: 'schedule' },
    ],
  },
  {
    id: 'inbox', label: 'Inbox',
    items: [
      { id: 'inbox_message', label: 'New Message', Icon: Inbox, sourceId: 'inbox' },
    ],
  },
  {
    id: 'comments', label: 'Comments / DM',
    items: [
      { id: 'comment_received', label: 'Comment Received', Icon: MessageCircle, sourceId: 'comments' },
      { id: 'dm_received', label: 'DM Received', Icon: MessageSquare, sourceId: 'comments' },
    ],
  },
  {
    id: 'finance', label: 'Finance',
    items: [
      { id: 'payment_received', label: 'Payment Received', Icon: Banknote, sourceId: 'finance' },
    ],
  },
  {
    id: 'lms', label: 'LMS',
    items: [
      { id: 'course_enrolled', label: 'Course Enrolled', Icon: GraduationCap, sourceId: 'lms' },
    ],
  },
  {
    id: 'broadcast', label: 'Broadcast',
    items: [
      { id: 'broadcast_to_group', label: 'Broadcast to Group', Icon: Radio, sourceId: 'broadcast' },
    ],
  },
  {
    id: 'calls', label: 'Calls',
    items: [
      { id: 'call_answered', label: 'Call Answered', Icon: PhoneCall, sourceId: 'calls' },
      { id: 'call_missed',   label: 'Call Missed',   Icon: PhoneMissed, sourceId: 'calls' },
    ],
  },
  {
    id: 'sheets', label: 'Spreadsheets',
    items: [
      { id: 'sheets_row_added', label: 'Google Sheet Row Added', Icon: FileText, sourceId: 'sheets' },
    ],
  },
];

// ── Action Categories ──────────────────────────────────────────────────────────
type ActionCategory = 'All' | 'Communication' | 'Conditions' | 'Operation' | 'Social' | 'External Apps' | 'Webhooks';

const ACTION_LIST: { id: string; label: string; desc: string; category: ActionCategory; Icon: ElementType; color: string }[] = [
  // ── CRM Operations ──────────────────────────────────────────────────────────
  { id: 'add_to_crm',           label: 'Add/Update to CRM',          desc: 'Add/Update Contact to CRM',                           category: 'Operation',     Icon: UserPlus,      color: 'bg-blue-100 text-blue-700' },
  { id: 'change_stage',         label: 'Change Pipeline Stage',       desc: 'Move lead to a different pipeline stage',             category: 'Operation',     Icon: ArrowLeftRight,color: 'bg-indigo-100 text-indigo-600' },
  { id: 'change_lead_quality',  label: 'Change Lead Quality',         desc: 'Change Lead Quality in CRM (Selected Pipeline)',      category: 'Operation',     Icon: Star,          color: 'bg-amber-100 text-amber-600' },
  { id: 'update_attributes',    label: "Update Contact's Attributes", desc: 'Update first name, last name, or any custom field',   category: 'Operation',     Icon: Pencil,        color: 'bg-violet-100 text-violet-600' },
  // ── Staff & AI ──────────────────────────────────────────────────────────────
  { id: 'assign_staff',         label: 'Assign To Staff',             desc: 'Assign lead to a specific staff member',              category: 'Operation',     Icon: UserCheck,     color: 'bg-teal-100 text-teal-600' },
  { id: 'remove_staff',         label: 'Remove Assigned Staff',       desc: 'Remove assigned staff from contact',                  category: 'Operation',     Icon: UserMinus,     color: 'bg-orange-100 text-orange-700' },
  { id: 'assign_ai',            label: 'Assign To AI Agent',          desc: 'Assign To AI Agent',                                  category: 'Operation',     Icon: Bot,           color: 'bg-purple-100 text-purple-600' },
  // ── Tags ────────────────────────────────────────────────────────────────────
  { id: 'add_tag',              label: 'Add Tag',                     desc: 'Apply one or more tags to the lead',                  category: 'Operation',     Icon: Tag,           color: 'bg-cyan-100 text-cyan-700' },
  { id: 'tag_contact',          label: 'Tag Contact',                 desc: 'Assign one or more tags to your contact',             category: 'Operation',     Icon: BookMarked,    color: 'bg-cyan-100 text-cyan-600' },
  { id: 'remove_tag',           label: 'Remove Tag',                  desc: 'Remove a tag from the lead',                         category: 'Operation',     Icon: Trash2,        color: 'bg-red-100 text-red-600' },
  // ── Calendar / Follow-up ────────────────────────────────────────────────────
  { id: 'create_followup',      label: 'Create Follow-up',            desc: 'Schedule a follow-up task',                          category: 'Operation',     Icon: CalendarPlus,  color: 'bg-rose-100 text-rose-600' },
  { id: 'change_appointment',   label: 'Change Appointment Status',   desc: 'Update Appointment Status to any',                   category: 'Operation',     Icon: CalendarCheck, color: 'bg-orange-100 text-orange-600' },
  { id: 'event_start_time',     label: 'Event Start Time',            desc: 'Event/Webinar time when it starts',                  category: 'Operation',     Icon: PlayCircle,    color: 'bg-yellow-100 text-yellow-700' },
  // ── Notes & Activities ──────────────────────────────────────────────────────
  { id: 'create_note',          label: 'Add Note',                    desc: 'Add a note to the lead record',                      category: 'Operation',     Icon: FileText,      color: 'bg-lime-100 text-lime-700' },
  // ── Contact Management ──────────────────────────────────────────────────────
  { id: 'broadcast_group',      label: 'Broadcast to Group',          desc: 'Send to all members of a contact group with interval', category: 'Operation',   Icon: Radio,         color: 'bg-orange-100 text-orange-700' },
  { id: 'contact_group',        label: 'Contact Group',               desc: 'Add, move, or remove contact in a contact group',    category: 'Operation',     Icon: Users,         color: 'bg-sky-100 text-sky-600' },
  { id: 'remove_contact',       label: 'Remove from Group',           desc: 'Remove contact from a specific contact group',       category: 'Operation',     Icon: UserX,         color: 'bg-red-100 text-red-700' },
  { id: 'remove_from_crm',      label: 'Remove from CRM',             desc: 'Remove contact from CRM',                            category: 'Operation',     Icon: FolderX,       color: 'bg-rose-100 text-rose-700' },
  // ── Workflow Control ────────────────────────────────────────────────────────
  { id: 'execute_automation',   label: 'Execute Automation',          desc: 'Can run another automation workflow',                 category: 'Operation',     Icon: Play,          color: 'bg-primary/10 text-primary' },
  { id: 'exit_workflow',        label: 'Exit Workflow',               desc: 'Stop executing the workflow',                        category: 'Operation',     Icon: LogOut,        color: 'bg-gray-100 text-gray-600' },
  { id: 'remove_workflow',      label: 'Remove Workflow',             desc: 'Remove a contact from the current workflow',         category: 'Operation',     Icon: X,             color: 'bg-slate-100 text-slate-600' },
  { id: 'pincode_routing',      label: 'Field Routing',               desc: 'Route lead to pipeline based on a field value',      category: 'Operation',     Icon: MapPin,        color: 'bg-green-100 text-green-700' },
  // ── Communication ───────────────────────────────────────────────────────────
  { id: 'send_email',           label: 'Send Email',                  desc: 'Send an automated email',                            category: 'Communication', Icon: Mail,          color: 'bg-blue-100 text-blue-600' },
  { id: 'send_sms',             label: 'Send SMS',                    desc: 'Send an automated SMS',                              category: 'Communication', Icon: Smartphone,    color: 'bg-green-100 text-green-700' },
  { id: 'send_whatsapp',        label: 'WhatsApp Message',            desc: 'Send an automated whatsapp message',                 category: 'Communication', Icon: MessageCircle, color: 'bg-emerald-100 text-emerald-700' },
  { id: 'send_whatsapp_personal', label: 'WhatsApp Personal',         desc: 'Send via connected personal WhatsApp (QR scan)',      category: 'Communication', Icon: Smartphone,    color: 'bg-teal-100 text-teal-700' },
  { id: 'internal_notify',      label: 'Internal Notification',       desc: 'Send an Internal Notification',                      category: 'Communication', Icon: Bell,          color: 'bg-purple-100 text-purple-600' },
  // ── Conditions / Timing ─────────────────────────────────────────────────────
  { id: 'if_else',              label: 'If / Else Condition',         desc: 'Branch based on a condition',                        category: 'Conditions',    Icon: GitBranch,     color: 'bg-amber-100 text-amber-600' },
  { id: 'delay',                label: 'Time Delay',                  desc: 'Wait before executing the next action',              category: 'Conditions',    Icon: Timer,         color: 'bg-sky-100 text-sky-600' },
  // ── Social ──────────────────────────────────────────────────────────────────
  { id: 'post_instagram',       label: 'Instagram DM',                desc: 'Send an Instagram direct message',                   category: 'Social',        Icon: Camera,        color: 'bg-pink-100 text-pink-600' },
  { id: 'facebook_post',        label: 'Facebook Comment Reply',      desc: 'Reply to a Facebook comment',                       category: 'Social',        Icon: ThumbsUp,      color: 'bg-blue-100 text-blue-800' },
  // ── Technical ───────────────────────────────────────────────────────────────
  { id: 'webhook_call',         label: 'Webhook Call',                desc: 'POST data to an external URL',                       category: 'Webhooks',      Icon: Globe,         color: 'bg-slate-100 text-slate-700' },
  { id: 'api_call',             label: 'API Request',                 desc: 'Make an HTTP GET/POST request',                      category: 'External Apps', Icon: Code,          color: 'bg-violet-100 text-violet-600' },
];

const ACTION_CATEGORIES: ActionCategory[] = ['All', 'Communication', 'Conditions', 'Operation', 'Social', 'External Apps', 'Webhooks'];

const EMAIL_TEMPLATES = ['Select Existing Template', 'Welcome Email', 'Proposal Sent', 'Follow-up Reminder', 'Onboarding Guide'];
const LEAD_QUALITIES = ['Hot', 'Warm', 'Cold', 'Unqualified'];
const CONTACT_LISTS = ['Newsletter', 'VIP Clients', 'Webinar Attendees', 'Trial Users'];
const APPT_STATUSES = ['Booked', 'Cancelled', 'Completed', 'No Show', 'Rescheduled'];
const AI_AGENTS = ['Sales Bot', 'Support Bot', 'Onboarding Bot', 'FAQ Bot'];
const COURSES = ['Sales Mastery', 'Marketing 101', 'Product Training', 'Onboarding Course'];
const FOLLOWUP_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Task'];
const CONDITION_FIELDS: { value: string; label: string; type: string }[] = [
  { value: 'first_name',     label: 'First Name',     type: 'text' },
  { value: 'last_name',      label: 'Last Name',      type: 'text' },
  { value: 'email',          label: 'Email',           type: 'text' },
  { value: 'phone',          label: 'Phone',           type: 'text' },
  { value: 'pipeline',       label: 'Pipeline',        type: 'pipeline' },
  { value: 'pipeline_stage', label: 'Pipeline Stage',  type: 'stage' },
  { value: 'lead_quality',   label: 'Lead Quality',    type: 'quality' },
  { value: 'tag',            label: 'Tag',             type: 'tag' },
  { value: 'source',         label: 'Source',          type: 'source' },
  { value: 'assigned_staff', label: 'Assigned Staff',  type: 'staff' },
  { value: 'district',       label: 'District',        type: 'text' },
];
const OPS_TEXT     = ['equals', 'not equals', 'contains', 'not contains', 'starts with', 'ends with', 'is empty', 'is not empty'];
const OPS_NUMBER   = ['equals', 'not equals', 'greater than', 'less than', 'is empty', 'is not empty'];
const OPS_SINGLE   = ['equals', 'not equals', 'is empty', 'is not empty'];
const OPS_TAG      = ['equals', 'not equals', 'contains', 'is empty', 'is not empty'];
const LEAD_SOURCES = ['Custom Form', 'Meta Form', 'WhatsApp', 'Manual', 'Referral', 'Website', 'Other'];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const INSTAGRAM_TEMPLATES = ['IG Welcome DM', 'IG Promo Offer', 'IG Event Invite'];
const FB_TEMPLATES = ['FB Thanks Reply', 'FB Promo Reply', 'FB Support Reply'];

// ── Per-action canvas accent colors ────────────────────────────────────────────
const ACTION_ACCENT: Record<string, { bar: string; icon: string; badge: string }> = {
  // CRM Operations
  add_to_crm:            { bar: 'bg-blue-600',    icon: 'bg-blue-50 text-blue-700',      badge: 'bg-blue-100 text-blue-800' },
  change_stage:          { bar: 'bg-indigo-500',  icon: 'bg-indigo-50 text-indigo-600',  badge: 'bg-indigo-100 text-indigo-700' },
  change_lead_quality:   { bar: 'bg-amber-500',   icon: 'bg-amber-50 text-amber-600',    badge: 'bg-amber-100 text-amber-700' },
  update_attributes:     { bar: 'bg-violet-500',  icon: 'bg-violet-50 text-violet-600',  badge: 'bg-violet-100 text-violet-700' },
  // Staff & AI
  assign_staff:          { bar: 'bg-teal-500',    icon: 'bg-teal-50 text-teal-600',      badge: 'bg-teal-100 text-teal-700' },
  remove_staff:          { bar: 'bg-orange-600',  icon: 'bg-orange-50 text-orange-700',  badge: 'bg-orange-100 text-orange-800' },
  assign_ai:             { bar: 'bg-purple-600',  icon: 'bg-purple-50 text-purple-700',  badge: 'bg-purple-100 text-purple-800' },
  // Tags
  add_tag:               { bar: 'bg-cyan-500',    icon: 'bg-cyan-50 text-cyan-700',      badge: 'bg-cyan-100 text-cyan-800' },
  tag_contact:           { bar: 'bg-cyan-600',    icon: 'bg-cyan-50 text-cyan-700',      badge: 'bg-cyan-100 text-cyan-800' },
  remove_tag:            { bar: 'bg-red-500',     icon: 'bg-red-50 text-red-600',        badge: 'bg-red-100 text-red-700' },
  // Calendar / Follow-up
  create_followup:       { bar: 'bg-rose-500',    icon: 'bg-rose-50 text-rose-600',      badge: 'bg-rose-100 text-rose-700' },
  change_appointment:    { bar: 'bg-orange-500',  icon: 'bg-orange-50 text-orange-600',  badge: 'bg-orange-100 text-orange-700' },
  event_start_time:      { bar: 'bg-yellow-500',  icon: 'bg-yellow-50 text-yellow-700',  badge: 'bg-yellow-100 text-yellow-800' },
  // Notes
  create_note:           { bar: 'bg-lime-600',    icon: 'bg-lime-50 text-lime-700',      badge: 'bg-lime-100 text-lime-800' },
  // Contact management
  broadcast_group:       { bar: 'bg-orange-500',  icon: 'bg-orange-50 text-orange-700',  badge: 'bg-orange-100 text-orange-800' },
  contact_group:         { bar: 'bg-sky-500',     icon: 'bg-sky-50 text-sky-600',        badge: 'bg-sky-100 text-sky-700' },
  contact_group_access:  { bar: 'bg-sky-600',     icon: 'bg-sky-50 text-sky-700',        badge: 'bg-sky-100 text-sky-800' },
  remove_contact:        { bar: 'bg-red-600',     icon: 'bg-red-50 text-red-700',        badge: 'bg-red-100 text-red-800' },
  remove_from_crm:       { bar: 'bg-rose-600',    icon: 'bg-rose-50 text-rose-700',      badge: 'bg-rose-100 text-rose-800' },
  // Workflow control
  execute_automation:    { bar: 'bg-primary',     icon: 'bg-primary/10 text-primary',    badge: 'bg-primary/10 text-primary' },
  exit_workflow:         { bar: 'bg-gray-500',    icon: 'bg-gray-100 text-gray-600',     badge: 'bg-gray-100 text-gray-700' },
  remove_workflow:       { bar: 'bg-slate-500',   icon: 'bg-slate-50 text-slate-600',    badge: 'bg-slate-100 text-slate-700' },
  pincode_routing:       { bar: 'bg-green-600',   icon: 'bg-green-50 text-green-700',    badge: 'bg-green-100 text-green-800' },
  // Communication
  send_email:            { bar: 'bg-blue-500',    icon: 'bg-blue-50 text-blue-600',      badge: 'bg-blue-100 text-blue-700' },
  send_sms:              { bar: 'bg-green-500',   icon: 'bg-green-50 text-green-700',    badge: 'bg-green-100 text-green-800' },
  send_whatsapp:         { bar: 'bg-emerald-600', icon: 'bg-emerald-50 text-emerald-700',badge: 'bg-emerald-100 text-emerald-800' },
  send_whatsapp_personal:{ bar: 'bg-teal-600',    icon: 'bg-teal-50 text-teal-700',      badge: 'bg-teal-100 text-teal-800' },
  internal_notify:       { bar: 'bg-purple-500',  icon: 'bg-purple-50 text-purple-600',  badge: 'bg-purple-100 text-purple-700' },
  // Social
  post_instagram:        { bar: 'bg-pink-500',    icon: 'bg-pink-50 text-pink-600',      badge: 'bg-pink-100 text-pink-700' },
  facebook_post:         { bar: 'bg-blue-700',    icon: 'bg-blue-100 text-blue-800',     badge: 'bg-blue-200 text-blue-900' },
  // Technical
  webhook_call:          { bar: 'bg-slate-600',   icon: 'bg-slate-50 text-slate-700',    badge: 'bg-slate-100 text-slate-800' },
  api_call:              { bar: 'bg-violet-600',  icon: 'bg-violet-50 text-violet-700',  badge: 'bg-violet-100 text-violet-800' },
};

// ── Node style helpers ─────────────────────────────────────────────────────────
const nodeStyle = (type: WFNode['type'], actionType?: string) => {
  if (type === 'trigger') return 'bg-indigo-500 hover:bg-indigo-600 text-white';
  if (type === 'condition') return 'bg-amber-500 hover:bg-amber-600 text-white';
  if (type === 'delay') return 'bg-sky-500 hover:bg-sky-600 text-white';
  if (actionType && ACTION_ACCENT[actionType]) return `${ACTION_ACCENT[actionType].bar} hover:opacity-90 text-white`;
  return 'bg-emerald-500 hover:bg-emerald-600 text-white';
};

const nodeAccent = (type: WFNode['type'], actionType?: string) => {
  if (type === 'trigger') return { bar: 'bg-primary', icon: 'bg-primary/10 text-primary', badge: 'bg-primary/10 text-primary' };
  if (type === 'condition') return { bar: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600', badge: 'bg-amber-100 text-amber-700' };
  if (type === 'delay') return { bar: 'bg-sky-500', icon: 'bg-sky-50 text-sky-600', badge: 'bg-sky-100 text-sky-700' };
  if (actionType && ACTION_ACCENT[actionType]) return ACTION_ACCENT[actionType];
  return { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' };
};

const NODE_TYPE_LABEL: Record<string, string> = { trigger: 'Trigger', condition: 'Condition', delay: 'Wait', action: 'Action' };

const nodeIcon = (actionType: string): ElementType => {
  const found = ACTION_LIST.find((a) => a.id === actionType);
  if (found) return found.Icon;
  for (const cat of TRIGGER_CATEGORIES) {
    const item = cat.items.find((i) => i.id === actionType);
    if (item) return item.Icon;
  }
  return Zap;
};

function NodeIconRenderer({ actionType }: { actionType: string }) {
  const Icon = nodeIcon(actionType);
  return <Icon className="w-4 h-4" />;
}

// Count all nodes including nested if/else branches — used to verify a save persisted.
function countNodes(nodes: any[]): number {
  let n = 0;
  for (const node of nodes ?? []) {
    n++;
    if (node?.branches?.yes) n += countNodes(node.branches.yes);
    if (node?.branches?.no)  n += countNodes(node.branches.no);
  }
  return n;
}

// Relative "time ago" label for the save indicator.
function relativeSince(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Shared field row ───────────────────────────────────────────────────────────
function FieldRow({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-semibold text-foreground mb-1.5 block">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1"><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />{hint}</p>}
    </div>
  );
}

const selectCls = 'w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none';
const inputCls = 'w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none';

// ── Trigger Config Panel ───────────────────────────────────────────────────────
type PipelineOpt = { id: string; name: string; stages: Array<{ id: string; name: string }> };
type StaffOpt = { id: string; name: string };
type FormOpt = { id: string; name: string };
type TemplateOpt = { id: string; name: string; body?: string };
type WaTemplate = { id: string; name: string; message: string; file_path: string | null; file_type: string | null; file_name: string | null; created_at: string; updated_at: string };

function TriggerConfigPanel({ node, onUpdate, onChangeTrigger, pipelines, staff, forms, metaForms, eventTypes, bookingLinks, metaPages, webhookUrls, contactGroups, sheetConfigs, allowReentry, onToggleReentry, workflowId, apiToken, onRegenerateToken }: {
  node: WFNode;
  onUpdate: (updates: Partial<WFNode>) => void;
  onChangeTrigger: () => void;
  pipelines: PipelineOpt[];
  staff: StaffOpt[];
  forms: FormOpt[];
  metaForms: FormOpt[];
  eventTypes: FormOpt[];
  bookingLinks: FormOpt[];
  metaPages: FormOpt[];
  webhookUrls: { webhookInbound: string; paymentReceived: string; courseEnrolled: string };
  contactGroups?: { id: string; name: string }[];
  sheetConfigs?: { id: string; spreadsheet_name: string; sheet_name: string }[];
  allowReentry: boolean;
  onToggleReentry: (val: boolean) => void;
  workflowId?: string;
  apiToken?: string;
  onRegenerateToken?: () => void;
}) {
  const cfg = node.config;
  const [allLeadTags, setAllLeadTags] = useState<string[]>([]);
  useEffect(() => {
    if (node.actionType !== 'contact_tagged') return;
    api.get<string[]>('/api/leads/tags').then(setAllLeadTags).catch(() => null);
  }, [node.actionType]);
  const sel = (field: string) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>) =>
    onUpdate({ config: { ...cfg, [field]: e.target.value } });

  const isMetaForm = node.actionType === 'meta_form';
  const isRegularForm = ['product_enquired', 'opt_in_form'].includes(node.actionType);
  const isAnyForm = isMetaForm || isRegularForm;
  const activeForms = isMetaForm ? metaForms : forms;

  return (
    <div className="space-y-5">

      {/* Forms triggers */}
      {isAnyForm && (() => {
        const selectedForms = (cfg.forms as string[]) ?? [];
        const noFormsSelected = selectedForms.length === 0;
        const metaNoForms = isMetaForm && metaForms.length === 0;
        return (<>
          <FieldRow
            label="Form"
            required
            hint={metaNoForms ? 'No active Meta forms. Enable a form in Meta Forms (toggle Auto ON) first.' : undefined}
          >
            <div className={cn(
              'w-full border rounded-lg px-3 py-2 min-h-10 flex flex-wrap gap-1.5 items-center cursor-text bg-card',
              noFormsSelected ? 'border-amber-400' : 'border-border'
            )}>
              {selectedForms.map((fId) => (
                <span key={fId} className="flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full">
                  {activeForms.find((f) => f.id === fId)?.name ?? fId}
                  <button onClick={() => onUpdate({ config: { ...cfg, forms: selectedForms.filter((x) => x !== fId) } })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <select className="flex-1 min-w-24 outline-none text-sm bg-transparent text-muted-foreground" value="" onChange={(e) => {
                if (e.target.value && !selectedForms.includes(e.target.value))
                  onUpdate({ config: { ...cfg, forms: [...selectedForms, e.target.value] } });
              }}>
                <option value="">+ Add form...</option>
                {activeForms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </FieldRow>

          {noFormsSelected && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">No form selected.</span> This workflow will stay inactive until at least one form is added.
              </p>
            </div>
          )}

          {isMetaForm && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-800 font-semibold mb-1">Facebook Lead Testing Tool</p>
              <p className="text-xs text-blue-700">Use this tool to simulate lead submissions and test your automation flow.</p>
              <a href="#" className="text-xs text-blue-600 font-medium hover:underline mt-1 block">Click here to access →</a>
            </div>
          )}
        </>);
      })()}

      {/* Calendar form submitted — pick which booking link(s) */}
      {node.actionType === 'calendar_form_submitted' && (
        <FieldRow label="Booking Calendar" hint="Select at least one calendar — no selection means this trigger is inactive.">
          <div className="w-full border border-border rounded-lg px-3 py-2 min-h-10 flex flex-wrap gap-1.5 items-center cursor-text bg-card">
            {((cfg.calendars as string[]) ?? []).map((blId) => (
              <span key={blId} className="flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full">
                {bookingLinks.find((bl) => bl.id === blId)?.name ?? blId}
                <button onClick={() => onUpdate({ config: { ...cfg, calendars: ((cfg.calendars as string[]) ?? []).filter((x) => x !== blId) } })}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <select
              className="flex-1 min-w-24 outline-none text-sm bg-transparent text-muted-foreground"
              value=""
              onChange={(e) => {
                if (e.target.value && !((cfg.calendars as string[]) ?? []).includes(e.target.value))
                  onUpdate({ config: { ...cfg, calendars: [...((cfg.calendars as string[]) ?? []), e.target.value] } });
              }}
            >
              <option value="">+ Add calendar...</option>
              {bookingLinks.map((bl) => <option key={bl.id} value={bl.id}>{bl.name}</option>)}
            </select>
          </div>
        </FieldRow>
      )}

      {/* CRM — stage changed */}
      {node.actionType === 'stage_changed' && (<>
        <FieldRow label="Select Pipeline">
          <select className={selectCls} value={(cfg.pipeline_id as string) ?? ''} onChange={(e) => onUpdate({ config: { ...cfg, pipeline_id: e.target.value, stage_id: '' } })}>
            <option value="">Any pipeline</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Select Pipeline Stage">
          <select className={selectCls} value={(cfg.stage_id as string) ?? ''} onChange={sel('stage_id')}>
            <option value="">Any stage</option>
            {(pipelines.find(p => p.id === (cfg.pipeline_id as string)))?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FieldRow>
      </>)}


      {/* CRM — follow up */}
      {node.actionType === 'follow_up' && (<>
        <FieldRow label="Follow-up Type">
          <select className={selectCls} value={(cfg.followupType as string) ?? ''} onChange={sel('followupType')}>
            <option value="">Any type</option>
            {FOLLOWUP_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Assigned To">
          <select className={selectCls} value={(cfg.assignedTo as string) ?? ''} onChange={sel('assignedTo')}>
            <option value="">Any staff</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FieldRow>
      </>)}

      {/* CRM — notes added */}
      {node.actionType === 'notes_added' && (
        <div className="py-4 text-center text-sm text-muted-foreground bg-muted/40 rounded-xl">
          <FilePlus className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-foreground">Notes Added</p>
          <p className="text-xs mt-1">Triggers whenever a note is added to any contact. No additional filter required.</p>
        </div>
      )}

      {/* Contact triggers */}
      {node.actionType === 'contact_created' && (<>
        <FieldRow label="Contact Source">
          <select className={selectCls} value={(cfg.source as string) ?? ''} onChange={sel('source')}>
            <option value="">Any source</option>
            {[
              { value: 'Manual',           label: 'Manual' },
              { value: 'meta_form',        label: 'Meta Form' },
              { value: 'Custom Form',      label: 'Custom Form' },
              { value: 'WhatsApp',         label: 'WhatsApp' },
              { value: 'Import',           label: 'Import' },
              { value: 'landing_page',     label: 'Landing Page' },
              { value: 'calendar_booking', label: 'Calendar Booking' },
              { value: 'Referral',         label: 'Referral' },
              { value: 'Website',          label: 'Website' },
              { value: 'Phone Call',       label: 'Phone Call' },
              { value: 'Paid Ad',          label: 'Paid Ad' },
              { value: 'Social Media',     label: 'Social Media' },
              { value: 'API',              label: 'API' },
            ].map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FieldRow>
      </>)}

      {node.actionType === 'contact_updated' && (<>
        <FieldRow label="Field Changed">
          <select className={selectCls} value={(cfg.fieldChanged as string) ?? ''} onChange={sel('fieldChanged')}>
            <option value="">Any field</option>
            {['first_name', 'last_name', 'email', 'phone', 'city', 'company', 'tag', 'assigned_staff'].map((f) => <option key={f}>{f}</option>)}
          </select>
        </FieldRow>
      </>)}

      {node.actionType === 'contact_tagged' && (() => {
        const selectedTags = (cfg.tags as string[]) ?? [];
        const noTagsSelected = selectedTags.length === 0;
        return (<>
          <FieldRow label="Tags" hint="Fires when any of these tags is added to a contact.">
            <div className={cn(
              'w-full border rounded-lg px-3 py-2 min-h-10 flex flex-wrap gap-1.5 items-center bg-card',
              noTagsSelected ? 'border-amber-400' : 'border-border'
            )}>
              {selectedTags.map((t) => (
                <span key={t} className="flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full">
                  {t}
                  <button onClick={() => onUpdate({ config: { ...cfg, tags: selectedTags.filter((x) => x !== t) } })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  if (selectedTags.includes(e.target.value)) return;
                  onUpdate({ config: { ...cfg, tags: [...selectedTags, e.target.value] } });
                }}
                className="flex-1 min-w-[120px] text-[12px] bg-transparent outline-none text-[#7a6b5c] cursor-pointer"
              >
                <option value="">+ Add tag...</option>
                {allLeadTags.filter((t) => !selectedTags.includes(t)).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </FieldRow>
          {noTagsSelected && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">No tag selected.</span> This workflow will fire for <span className="font-semibold">every tag added to any contact</span>. Add at least one tag to restrict it.
              </p>
            </div>
          )}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800">
              <span className="font-semibold">Re-entry tip:</span> By default this workflow fires only <span className="font-semibold">once per contact</span>. If the tag is removed and re-added later, the workflow won't fire again — enable <span className="font-semibold">Allow Re-entry</span> in the settings panel to fire every time the tag is added.
            </p>
          </div>
        </>);
      })()}

      {/* Calendar triggers */}
      {['appointment_booked', 'appointment_cancelled', 'appointment_rescheduled', 'appointment_noshow', 'appointment_showup'].includes(node.actionType) && (
        <FieldRow label="Booking Link (optional)" hint="Only fire for appointments from this calendar. Leave empty to fire for all.">
          <div className="w-full border border-border rounded-lg px-3 py-2 min-h-10 flex flex-wrap gap-1.5 items-center cursor-text bg-card">
            {((cfg.calendars as string[]) ?? []).map((blId) => (
              <span key={blId} className="flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full">
                {bookingLinks.find((bl) => bl.id === blId)?.name ?? blId}
                <button onClick={() => onUpdate({ config: { ...cfg, calendars: ((cfg.calendars as string[]) ?? []).filter((x) => x !== blId) } })}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <select className="flex-1 min-w-[120px] bg-transparent text-sm outline-none cursor-pointer" value=""
              onChange={(e) => {
                if (!e.target.value) return;
                if (((cfg.calendars as string[]) ?? []).includes(e.target.value)) return;
                onUpdate({ config: { ...cfg, calendars: [...((cfg.calendars as string[]) ?? []), e.target.value] } });
              }}>
              <option value="">+ Add calendar...</option>
              {bookingLinks.map((bl) => <option key={bl.id} value={bl.id}>{bl.name}</option>)}
            </select>
          </div>
        </FieldRow>
      )}

      {/* Webhook / API trigger */}
      {node.actionType === 'webhook_inbound' && (() => {
        const base = webhookUrls.webhookInbound
          ? webhookUrls.webhookInbound.replace(/\/api\/public\/webhook-inbound\/.*$/, '')
          : '';
        const executeUrl = workflowId && workflowId !== 'new' && base
          ? `${base}/api/wf/${workflowId}/execute`
          : '';
        const curlExample = executeUrl && apiToken
          ? `curl -X POST "${executeUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"api_token":"${apiToken}","contact_name":"John","contact_email":"john@email.com","contact_phone":"+919999999999"}'`
          : '';

        return (<>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
            <p className="text-xs text-indigo-800">
              Automation is triggered from an external application using a POST request to the endpoint below. Each workflow has its own unique URL and API token.
            </p>
          </div>

          {/* Endpoint URL */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">Endpoint URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-2 rounded-lg break-all font-mono">
                {executeUrl || 'Save workflow to generate URL…'}
              </code>
              {executeUrl && (
                <button onClick={() => { copyToClipboard(executeUrl); toast.success('URL copied!'); }}
                  className="shrink-0 p-1.5 rounded-lg border border-black/10 hover:bg-black/5">
                  <Copy className="w-3.5 h-3.5 text-[#7a6b5c]" />
                </button>
              )}
            </div>
          </div>

          {/* API Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">API Token</label>
              {onRegenerateToken && (
                <button onClick={onRegenerateToken}
                  className="text-[11px] text-primary font-semibold hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] bg-muted border border-black/10 px-3 py-2 rounded-lg font-mono break-all text-[#1c1410]">
                {apiToken || 'Save workflow to generate token…'}
              </code>
              {apiToken && (
                <button onClick={() => { copyToClipboard(apiToken!); toast.success('Token copied!'); }}
                  className="shrink-0 p-1.5 rounded-lg border border-black/10 hover:bg-black/5">
                  <Copy className="w-3.5 h-3.5 text-[#7a6b5c]" />
                </button>
              )}
            </div>
          </div>

          {/* CURL example */}
          {curlExample && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">CURL Example</label>
                <button onClick={() => { copyToClipboard(curlExample); toast.success('CURL copied!'); }}
                  className="text-[11px] text-primary font-semibold hover:underline flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <pre className="text-[10px] bg-slate-900 text-green-400 px-3 py-3 rounded-xl overflow-x-auto font-mono whitespace-pre-wrap leading-relaxed">
                {curlExample}
              </pre>
            </div>
          )}

          {/* Required params */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">API Parameters (Required)</label>
            <div className="space-y-1.5 text-[12px]">
              {[
                ['api_token', 'Your authentication token for secure API access'],
                ['contact_email', 'Email address of the contact (or use contact_phone)'],
                ['contact_phone', 'Phone number of the contact (or use contact_email)'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start gap-2">
                  <code className="shrink-0 bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono text-[11px]">{k}</code>
                  <span className="text-[#7a6b5c]">{v}</span>
                </div>
              ))}
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                Note: At least one of <code className="font-mono">contact_email</code> or <code className="font-mono">contact_phone</code> is required.
              </p>
            </div>
          </div>

          {/* Optional params */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">API Parameters (Optional)</label>
            <div className="space-y-1.5 text-[12px]">
              {[
                ['contact_name', 'Full name of the contact'],
                ['any_custom_key', 'Any extra key-value pairs are saved as custom fields on the lead'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start gap-2">
                  <code className="shrink-0 bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono text-[11px]">{k}</code>
                  <span className="text-[#7a6b5c]">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Headers */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">API Headers</label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-[11px] text-slate-700 space-y-0.5">
              <div>- Content-Type: application/json</div>
              <div>- Accept: application/json</div>
            </div>
          </div>

          {/* Response example */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">API Response</label>
            <pre className="text-[10px] bg-slate-900 text-green-400 px-3 py-3 rounded-xl font-mono">{`{
  "status": "success",
  "message": "Automation triggered successfully",
  "data": {
    "automation_id": "${workflowId || 'your-workflow-id'}"
  }
}`}</pre>
          </div>
        </>);
      })()}

      {/* Schedule triggers */}
      {node.actionType === 'specific_date' && (<>
        <FieldRow label="Date" required>
          <input type="date" className={inputCls} value={(cfg.date as string) ?? ''} onChange={sel('date')} />
        </FieldRow>
        <FieldRow label="Time">
          <input type="time" className={inputCls} value={(cfg.time as string) ?? '09:00'} onChange={sel('time')} />
        </FieldRow>
        <FieldRow label="Timezone">
          <select className={selectCls} value={(cfg.timezone as string) ?? 'Asia/Kolkata'} onChange={sel('timezone')}>
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
          </select>
        </FieldRow>
      </>)}

      {node.actionType === 'weekly_recurring' && (<>
        <FieldRow label="Day of Week" required>
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map((day) => {
              const selected = ((cfg.days as string[]) ?? []).includes(day);
              return (
                <button key={day} type="button"
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                    selected ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary')}
                  onClick={() => {
                    const curr = (cfg.days as string[]) ?? [];
                    onUpdate({ config: { ...cfg, days: selected ? curr.filter((d) => d !== day) : [...curr, day] } });
                  }}
                >{day.slice(0, 3)}</button>
              );
            })}
          </div>
        </FieldRow>
        <FieldRow label="Time">
          <input type="time" className={inputCls} value={(cfg.time as string) ?? '09:00'} onChange={sel('time')} />
        </FieldRow>
      </>)}

      {node.actionType === 'monthly_recurring' && (<>
        <FieldRow label="Day of Month" required>
          <select className={selectCls} value={(cfg.dayOfMonth as string) ?? ''} onChange={sel('dayOfMonth')}>
            <option value="">Select day...</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            <option value="last">Last day of month</option>
          </select>
        </FieldRow>
        <FieldRow label="Time">
          <input type="time" className={inputCls} value={(cfg.time as string) ?? '09:00'} onChange={sel('time')} />
        </FieldRow>
      </>)}

      {node.actionType === 'event_date' && (<>
        <FieldRow label="Event / Webinar">
          <select className={selectCls} value={(cfg.eventId as string) ?? ''} onChange={sel('eventId')}>
            <option value="">Select event...</option>
            <option value="evt1">Sales Webinar — April 20</option>
            <option value="evt2">Product Launch — May 5</option>
            <option value="evt3">Training Workshop — May 15</option>
          </select>
        </FieldRow>
        <FieldRow label="Trigger Offset">
          <div className="flex gap-2">
            <input type="number" className="w-24 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none" value={(cfg.offsetAmount as string) ?? '0'} onChange={sel('offsetAmount')} min="0" />
            <select className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={(cfg.offsetUnit as string) ?? 'hours_before'} onChange={sel('offsetUnit')}>
              <option value="hours_before">hours before</option>
              <option value="days_before">days before</option>
              <option value="hours_after">hours after</option>
              <option value="days_after">days after</option>
            </select>
          </div>
        </FieldRow>
      </>)}

      {/* Inbox trigger */}
      {node.actionType === 'inbox_message' && (<>
        <FieldRow label="Channel">
          <select className={selectCls} value={(cfg.channel as string) ?? ''} onChange={sel('channel')}>
            <option value="">Any channel</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="instagram">Instagram DM</option>
            <option value="facebook">Facebook DM</option>
          </select>
        </FieldRow>
        <FieldRow label="Keyword Filter (optional)">
          <input className={inputCls} placeholder="e.g. pricing, demo, help" value={(cfg.keyword as string) ?? ''} onChange={sel('keyword')} />
          <p className="text-xs text-muted-foreground mt-1">Trigger only when message contains this keyword.</p>
        </FieldRow>
      </>)}

      {/* Comments / DM triggers */}
      {(node.actionType === 'comment_received' || node.actionType === 'dm_received') && (<>
        <FieldRow label="Facebook Page">
          <select className={selectCls} value={(cfg.page as string) ?? ''} onChange={sel('page')}>
            <option value="">Any connected page</option>
            {metaPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FieldRow>
        {node.actionType === 'comment_received' && (
          <FieldRow label="Post ID Filter (optional)">
            <input className={inputCls} placeholder="Leave blank to match any post" value={(cfg.post as string) ?? ''} onChange={sel('post')} />
          </FieldRow>
        )}
        <FieldRow label="Keyword Filter (optional)">
          <input className={inputCls} placeholder="e.g. price, interested, yes" value={(cfg.keyword as string) ?? ''} onChange={sel('keyword')} />
        </FieldRow>
      </>)}

      {/* Finance trigger */}
      {node.actionType === 'payment_received' && (<>
        <div className="bg-muted/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2"><Code2 className="w-4 h-4" /> Payment Webhook URL</p>
          <p className="text-xs text-muted-foreground">POST from Razorpay / Stripe with <code className="bg-muted px-1 rounded">email</code> or <code className="bg-muted px-1 rounded">phone</code> to trigger this workflow.</p>
          <code className="text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg block break-all">
            {webhookUrls.paymentReceived || 'Loading...'}
          </code>
          {webhookUrls.paymentReceived && (
            <button className="text-xs text-primary font-medium flex items-center gap-1 hover:underline" onClick={() => { copyToClipboard(webhookUrls.paymentReceived); toast.success('Copied!'); }}>
              <Copy className="w-3 h-3" /> Copy URL
            </button>
          )}
        </div>
        <FieldRow label="Minimum Amount (optional)">
          <input type="number" className={inputCls} placeholder="e.g. 500" value={(cfg.minAmount as string) ?? ''} onChange={sel('minAmount')} min="0" />
        </FieldRow>
      </>)}

      {/* LMS trigger */}
      {node.actionType === 'course_enrolled' && (<>
        <div className="bg-muted/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2"><Code2 className="w-4 h-4" /> Course Enrolment Webhook URL</p>
          <p className="text-xs text-muted-foreground">POST from your LMS with <code className="bg-muted px-1 rounded">email</code> or <code className="bg-muted px-1 rounded">phone</code> to trigger this workflow.</p>
          <code className="text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg block break-all">
            {webhookUrls.courseEnrolled || 'Loading...'}
          </code>
          {webhookUrls.courseEnrolled && (
            <button className="text-xs text-primary font-medium flex items-center gap-1 hover:underline" onClick={() => { copyToClipboard(webhookUrls.courseEnrolled); toast.success('Copied!'); }}>
              <Copy className="w-3 h-3" /> Copy URL
            </button>
          )}
        </div>
        <FieldRow label="Course Name Filter (optional)">
          <input className={inputCls} placeholder="Leave blank to match any course" value={(cfg.course as string) ?? ''} onChange={sel('course')} />
        </FieldRow>
      </>)}

      {/* Contact Group Added trigger */}
      {node.actionType === 'contact_group_added' && (
        <FieldRow label="Contact Group" hint="Leave blank to fire when added to any group.">
          <select className={selectCls} value={(cfg.group_id as string) ?? ''} onChange={sel('group_id')}>
            <option value="">Any group</option>
            {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldRow>
      )}

      {/* Calls triggers */}
      {(node.actionType === 'call_answered' || node.actionType === 'call_missed') && (
        <FieldRow label="Direction" hint="Leave blank to fire for any call direction.">
          <select className={selectCls} value={(cfg.direction as string) ?? ''} onChange={sel('direction')}>
            <option value="">Any direction</option>
            <option value="INBOUND">Inbound</option>
            <option value="OUTBOUND">Outbound</option>
          </select>
        </FieldRow>
      )}

      {/* Google Sheets trigger */}
      {node.actionType === 'sheets_row_added' && (
        <>
          <FieldRow label="Watch Sheet" hint="Leave blank to fire for any connected Google Sheet.">
            <div className="w-full border border-border rounded-lg px-3 py-2 min-h-10 flex flex-wrap gap-1.5 items-center cursor-text bg-card">
              {((cfg.config_ids as string[]) ?? []).map((cid) => (
                <span key={cid} className="flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full">
                  {(() => {
                    const sc = (sheetConfigs ?? []).find((s) => s.id === cid);
                    return sc ? `${sc.spreadsheet_name} › ${sc.sheet_name}` : cid;
                  })()}
                  <button onClick={() => onUpdate({ config: { ...cfg, config_ids: ((cfg.config_ids as string[]) ?? []).filter((x) => x !== cid) } })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <select
                className="flex-1 min-w-24 outline-none text-sm bg-transparent text-muted-foreground"
                value=""
                onChange={(e) => {
                  if (e.target.value && !((cfg.config_ids as string[]) ?? []).includes(e.target.value))
                    onUpdate({ config: { ...cfg, config_ids: [...((cfg.config_ids as string[]) ?? []), e.target.value] } });
                }}
              >
                <option value="">+ Add sheet...</option>
                {(sheetConfigs ?? []).map((sc) => (
                  <option key={sc.id} value={sc.id}>{sc.spreadsheet_name} › {sc.sheet_name}</option>
                ))}
              </select>
            </div>
          </FieldRow>
          {(sheetConfigs ?? []).length === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">No sheets connected.</span> Go to Settings → Integrations → Google Sheets to connect a spreadsheet first.
              </p>
            </div>
          )}
        </>
      )}

      {node.actionType === 'broadcast_to_group' && (<>
        <FieldRow label="Contact Group" required hint="All members of this group will receive the broadcast.">
          <select className={selectCls} value={(cfg.group_id as string) ?? ''} onChange={sel('group_id')}>
            <option value="">Select a group...</option>
            {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldRow>
        {!(cfg.group_id) && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">No group selected.</span> Select a contact group before running the broadcast.
            </p>
          </div>
        )}
        <FieldRow label="Interval between each message" required>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={3600}
              className="w-20 border border-border rounded-lg px-3 py-2 text-sm bg-card outline-none focus:border-primary/50"
              value={Number(cfg.interval_value ?? 2)}
              onChange={(e) => onUpdate({ config: { ...cfg, interval_value: e.target.value } })}
            />
            <select
              className={selectCls}
              value={(cfg.interval_unit as string) ?? 'minutes'}
              onChange={sel('interval_unit')}
            >
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </div>
        </FieldRow>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800 font-semibold mb-1">How to use</p>
          <p className="text-xs text-blue-700">
            After saving, click <strong>Run Broadcast</strong> in the workflow list to start sending. Messages go out one by one with the interval you set.
          </p>
        </div>
      </>)}

      {(!node.actionType || node.actionType === '') && (
        <div className="py-6 text-center text-sm text-muted-foreground">
          <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No trigger selected.</p>
          <p className="text-xs mt-1">Click "Change Trigger" to pick a trigger source.</p>
        </div>
      )}


      {/* Re-entry setting */}
      {node.actionType && (
        <div className="border-t border-border pt-4">
          <label className="flex items-start gap-3 cursor-pointer group select-none">
            <input
              type="checkbox"
              checked={allowReentry}
              onChange={(e) => onToggleReentry(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded cursor-pointer shrink-0 accent-orange-600"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">Allow Re-entry</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-medium text-[var(--brand-dark)]">Checked:</span> every contact enters this workflow each time they trigger it, even if they've been through it before.<br />
                <span className="font-medium">Unchecked:</span> only contacts that have never entered this workflow will be enrolled (default).
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

// ── Variable hints bar (shown under text areas) ───────────────────────────────
const VARIABLE_HINTS = ['{first_name}', '{last_name}', '{email}', '{phone}', '{stage}', '{pipeline}', '{assigned_staff}', '{source}', '{today}'];
function VarHints({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {VARIABLE_HINTS.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(v)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-mono transition-colors">
          {v}
        </button>
      ))}
    </div>
  );
}

// ── Condition Config Panel ─────────────────────────────────────────────────────
interface CondRow { field: string; operator: string; value: string }

function ConditionConfigPanel({ node, onUpdate, pipelines, staff }: {
  node: WFNode;
  onUpdate: (updates: Partial<WFNode>) => void;
  pipelines: PipelineOpt[];
  staff: StaffOpt[];
}) {
  const cfg = node.config;
  const customFields = useCrmStore((s) => s.customFields);
  const tags = useCrmStore((s) => s.tags);
  const sel = (field: string) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    onUpdate({ config: { ...cfg, [field]: e.target.value } });

  const conditions: CondRow[] = (cfg.conditions as CondRow[] | undefined) ?? [
    { field: (cfg.field as string) ?? '', operator: (cfg.operator as string) ?? '', value: (cfg.value as string) ?? '' },
  ];
  const logic = (cfg.logic as string) ?? 'AND';

  const updateConditions = (next: CondRow[]) =>
    onUpdate({ config: { ...cfg, conditions: next, logic } });

  const addCondition = () => updateConditions([...conditions, { field: '', operator: '', value: '' }]);
  const removeCondition = (i: number) => updateConditions(conditions.filter((_, idx) => idx !== i));
  const editCondition = (i: number, key: keyof CondRow, val: string) => {
    const next = conditions.map((c, idx) => {
      if (idx !== i) return c;
      // reset operator + value when field changes
      if (key === 'field') return { field: val, operator: '', value: '' };
      // reset value when operator changes to empty-check
      if (key === 'operator' && ['is empty', 'is not empty'].includes(val)) return { ...c, operator: val, value: '' };
      return { ...c, [key]: val };
    });
    updateConditions(next);
  };

  // Resolve field type — check standard fields first, then custom fields
  const getFieldType = (fieldVal: string): string => {
    const std = CONDITION_FIELDS.find((f) => f.value === fieldVal);
    if (std) return std.type;
    const cf = customFields.find((c) => c.slug === fieldVal);
    if (!cf) return 'text';
    if (cf.type === 'Number') return 'number';
    if (cf.type === 'Dropdown') return 'custom_dropdown';
    return 'text';
  };

  const getOperators = (fieldType: string): string[] => {
    switch (fieldType) {
      case 'pipeline':
      case 'stage':
      case 'staff':
      case 'quality':
      case 'source':       return OPS_SINGLE;
      case 'tag':          return OPS_TAG;
      case 'number':       return OPS_NUMBER;
      default:             return OPS_TEXT;
    }
  };

  // Preview sentence
  const previewParts = conditions.map((c) => {
    if (!c.field || !c.operator) return null;
    const fieldLabel = CONDITION_FIELDS.find((f) => f.value === c.field)?.label
      ?? customFields.find((cf) => cf.slug === c.field)?.name
      ?? c.field;
    const valLabel = (() => {
      const ft = getFieldType(c.field);
      if (ft === 'pipeline') return pipelines.find((p) => p.id === c.value)?.name ?? c.value;
      if (ft === 'stage') {
        for (const p of pipelines) { const s = p.stages.find((st) => st.id === c.value); if (s) return s.name; }
        return c.value;
      }
      if (ft === 'staff') return staff.find((s) => s.id === c.value)?.name ?? c.value;
      return c.value;
    })();
    const noVal = ['is empty', 'is not empty'].includes(c.operator);
    return `${fieldLabel} ${c.operator}${noVal ? '' : ` "${valLabel}"`}`;
  }).filter(Boolean);

  const renderValueInput = (cond: CondRow, i: number) => {
    const hideValue = ['is empty', 'is not empty'].includes(cond.operator);
    if (hideValue || !cond.operator) return null;
    const ft = getFieldType(cond.field);

    if (ft === 'pipeline') return (
      <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
        <option value="">— Select pipeline —</option>
        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );

    if (ft === 'stage') {
      const allStages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name })));
      return (
        <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
          <option value="">— Select stage —</option>
          {pipelines.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      );
    }

    if (ft === 'staff') return (
      <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
        <option value="">— Select staff —</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    );

    if (ft === 'tag') return (
      <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
        <option value="">— Select tag —</option>
        {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
      </select>
    );

    if (ft === 'source') return (
      <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
        <option value="">— Select source —</option>
        {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );

    if (ft === 'quality') return (
      <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
        <option value="">— Select quality —</option>
        {LEAD_QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
      </select>
    );

    if (ft === 'custom_dropdown') {
      const cf = customFields.find((c) => c.slug === cond.field);
      const opts: string[] = Array.isArray(cf?.options) ? cf!.options as string[] : [];
      return (
        <select className={selectCls} value={cond.value} onChange={(e) => editCondition(i, 'value', e.target.value)}>
          <option value="">— Select option —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    if (ft === 'number') return (
      <input type="number" className={inputCls} placeholder="Enter number..." value={cond.value}
        onChange={(e) => editCondition(i, 'value', e.target.value)} />
    );

    return (
      <input className={inputCls} placeholder="Enter value..." value={cond.value}
        onChange={(e) => editCondition(i, 'value', e.target.value)} />
    );
  };

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-xs text-amber-800 flex items-start gap-1.5">
          <GitBranch className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Splits the workflow into <strong>YES</strong> and <strong>NO</strong> branches based on the conditions below.
        </p>
      </div>

      <FieldRow label="Condition Name">
        <input className={inputCls} placeholder="e.g. Is the lead from Chennai?" value={(cfg.conditionName as string) ?? ''} onChange={sel('conditionName')} />
      </FieldRow>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-foreground">Condition Rules</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Match</span>
            <select className="text-xs border border-border rounded-md px-2 py-1 bg-background"
              value={logic}
              onChange={(e) => onUpdate({ config: { ...cfg, logic: e.target.value, conditions } })}>
              <option value="AND">ALL (AND)</option>
              <option value="OR">ANY (OR)</option>
            </select>
          </div>
        </div>

        {/* Plain-English preview */}
        {previewParts.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <p className="text-[11px] text-blue-700 font-medium">
              IF {previewParts.join(` ${logic} `)}
            </p>
          </div>
        )}

        {conditions.map((cond, i) => {
          const fieldType = getFieldType(cond.field);
          const operators = getOperators(fieldType);
          return (
            <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Rule {i + 1}</span>
                {conditions.length > 1 && (
                  <button type="button" onClick={() => removeCondition(i)}
                    className="text-destructive hover:text-destructive/80 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Field selector */}
              <select className={selectCls} value={cond.field} onChange={(e) => editCondition(i, 'field', e.target.value)}>
                <option value="">— Select field —</option>
                <optgroup label="Lead Fields">
                  {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </optgroup>
                {customFields.length > 0 && (
                  <optgroup label="Custom Fields">
                    {customFields.map((cf) => <option key={cf.id} value={cf.slug}>{cf.name}</option>)}
                  </optgroup>
                )}
              </select>

              {/* Operator selector — shown only after field picked */}
              {cond.field && (
                <select className={selectCls} value={cond.operator} onChange={(e) => editCondition(i, 'operator', e.target.value)}>
                  <option value="">— Select condition —</option>
                  {operators.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}

              {/* Smart value input */}
              {cond.field && cond.operator && renderValueInput(cond, i)}
            </div>
          );
        })}

        <button type="button" onClick={addCondition}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add condition
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground block">Branch Labels</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-xs font-medium text-green-700">YES branch</span>
            </div>
            <input className={inputCls} placeholder="e.g. Condition met" value={(cfg.yesLabel as string) ?? 'Yes'} onChange={sel('yesLabel')} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-xs font-medium text-red-700">NO branch</span>
            </div>
            <input className={inputCls} placeholder="e.g. Condition not met" value={(cfg.noLabel as string) ?? 'No'} onChange={sel('noLabel')} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tag chip input ─────────────────────────────────────────────────────────────
function TagChipInput({ tags, onChange, placeholder }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const addTag = (val: string) => {
    const t = val.trim().replace(/,+$/, '').trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
    if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-gray-200 bg-white min-h-[38px] focus-within:border-primary/40 transition-colors">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-700 text-[11px] font-semibold">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:text-red-500 transition-colors">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? (placeholder ?? 'Type and press Enter…') : 'Add more…'}
        className="flex-1 min-w-[100px] text-[12px] bg-transparent outline-none text-[#1c1410] placeholder:text-[#b09e8d]"
      />
    </div>
  );
}

// ── Assign Staff Panel (multi-select tags + split traffic + by-pipeline mode) ──
function AssignStaffPanel({ cfg, staff, pipelines, onUpdate }: {
  cfg: Record<string, unknown>;
  staff: StaffOpt[];
  pipelines: PipelineOpt[];
  onUpdate: (updates: Partial<WFNode>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const assignMode = (cfg.assign_mode as string) ?? 'specific';
  const mapping: Array<{ pipeline_id: string; staff_ids?: string[]; staff_id?: string }> =
    Array.isArray(cfg.pipeline_staff_mapping)
      ? (cfg.pipeline_staff_mapping as Array<{ pipeline_id: string; staff_ids?: string[]; staff_id?: string }>)
      : [];
  const rrPairs: Array<{ pipeline_id: string; stage_id: string; staff_id: string }> =
    Array.isArray(cfg.round_robin_pairs)
      ? (cfg.round_robin_pairs as Array<{ pipeline_id: string; stage_id: string; staff_id: string }>)
      : [];
  const addRRPair = () => onUpdate({ config: { ...cfg, round_robin_pairs: [...rrPairs, { pipeline_id: '', stage_id: '', staff_id: '' }] } });
  const removeRRPair = (i: number) => onUpdate({ config: { ...cfg, round_robin_pairs: rrPairs.filter((_, idx) => idx !== i) } });
  const updateRRPair = (i: number, field: string, val: string) => {
    const next = rrPairs.map((p, idx) => idx === i ? { ...p, [field]: val, ...(field === 'pipeline_id' ? { stage_id: '' } : {}) } : p);
    onUpdate({ config: { ...cfg, round_robin_pairs: next } });
  };

  const selectedIds: string[] = Array.isArray(cfg.staff_ids) ? (cfg.staff_ids as string[]) : [];
  const selectedStaff = selectedIds.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as StaffOpt[];
  const unselected = staff.filter((s) => !selectedIds.includes(s.id));
  const isMulti = selectedIds.length >= 2;
  const splitMode = (cfg.split_traffic as string) ?? 'evenly';
  const weights = (cfg.staff_weights as Record<string, number>) ?? {};

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addStaff = (id: string) => {
    const newIds = [...selectedIds, id];
    // When adding staff to weighted mode, distribute weights evenly across all
    const newWeights: Record<string, number> = {};
    if (splitMode === 'weighted') {
      const each = Math.floor(100 / newIds.length);
      newIds.forEach((sid, i) => { newWeights[sid] = i === newIds.length - 1 ? 100 - each * (newIds.length - 1) : each; });
    }
    onUpdate({ config: { ...cfg, staff_ids: newIds, ...(splitMode === 'weighted' ? { staff_weights: newWeights } : {}) } });
  };

  const removeStaff = (id: string) => {
    const newIds = selectedIds.filter((x) => x !== id);
    const newWeights: Record<string, number> = { ...weights };
    delete newWeights[id];
    // Re-normalize weights after removal
    if (splitMode === 'weighted' && newIds.length > 0) {
      const each = Math.floor(100 / newIds.length);
      newIds.forEach((sid, i) => { newWeights[sid] = i === newIds.length - 1 ? 100 - each * (newIds.length - 1) : each; });
    }
    onUpdate({ config: { ...cfg, staff_ids: newIds, staff_weights: newWeights } });
  };

  const setWeight = (id: string, val: number) => {
    onUpdate({ config: { ...cfg, staff_weights: { ...weights, [id]: val } } });
  };

  const handleSplitModeChange = (mode: string) => {
    // When switching to weighted, initialize equal percentages
    const newWeights: Record<string, number> = {};
    if (mode === 'weighted' && selectedIds.length > 0) {
      const each = Math.floor(100 / selectedIds.length);
      selectedIds.forEach((id, i) => { newWeights[id] = i === selectedIds.length - 1 ? 100 - each * (selectedIds.length - 1) : each; });
    }
    onUpdate({ config: { ...cfg, split_traffic: mode, staff_weights: newWeights } });
  };

  const totalWeight = selectedIds.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  const weightValid = totalWeight === 100;

  const updateMappingPipeline = (i: number, val: string) => {
    const newMapping = mapping.map((m, idx) => idx === i ? { ...m, pipeline_id: val } : m);
    onUpdate({ config: { ...cfg, pipeline_staff_mapping: newMapping } });
  };
  const addStaffToRow = (i: number, staffId: string) => {
    const newMapping = mapping.map((m, idx) => {
      if (idx !== i) return m;
      const ids = Array.isArray(m.staff_ids) ? m.staff_ids : (m.staff_id ? [m.staff_id] : []);
      return { ...m, staff_ids: [...ids, staffId], staff_id: undefined };
    });
    onUpdate({ config: { ...cfg, pipeline_staff_mapping: newMapping } });
  };
  const removeStaffFromRow = (i: number, staffId: string) => {
    const newMapping = mapping.map((m, idx) => {
      if (idx !== i) return m;
      const ids = Array.isArray(m.staff_ids) ? m.staff_ids : (m.staff_id ? [m.staff_id] : []);
      return { ...m, staff_ids: ids.filter((id) => id !== staffId), staff_id: undefined };
    });
    onUpdate({ config: { ...cfg, pipeline_staff_mapping: newMapping } });
  };
  const addMappingRow = () => onUpdate({ config: { ...cfg, pipeline_staff_mapping: [...mapping, { pipeline_id: '', staff_ids: [] }] } });
  const removeMappingRow = (i: number) => onUpdate({ config: { ...cfg, pipeline_staff_mapping: mapping.filter((_, idx) => idx !== i) } });

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div>
        <label className="block text-[13px] font-semibold text-[#1c1410] mb-1.5">Assignment Mode</label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px] font-semibold">
          <button type="button" className={`flex-1 py-2 transition-colors ${assignMode === 'specific' ? 'bg-primary text-white' : 'bg-white text-[#7a6b5c] hover:bg-gray-50'}`} onClick={() => onUpdate({ config: { ...cfg, assign_mode: 'specific' } })}>Specific Staff</button>
          <button type="button" className={`flex-1 py-2 transition-colors ${assignMode === 'by_pipeline' ? 'bg-primary text-white' : 'bg-white text-[#7a6b5c] hover:bg-gray-50'}`} onClick={() => onUpdate({ config: { ...cfg, assign_mode: 'by_pipeline' } })}>By Pipeline</button>
          <button type="button" className={`flex-1 py-2 transition-colors ${assignMode === 'round_robin' ? 'bg-primary text-white' : 'bg-white text-[#7a6b5c] hover:bg-gray-50'}`} onClick={() => onUpdate({ config: { ...cfg, assign_mode: 'round_robin' } })}>Round Robin</button>
        </div>
      </div>

      {assignMode === 'round_robin' ? (
        <div className="space-y-2">
          <label className="block text-[13px] font-semibold text-[#1c1410]">Pipeline + Staff Rotation</label>
          <p className="text-[11px] text-[#9a8a7a]">Leads alternate between these pairs in order. Each pair gets an equal share.</p>
          {rrPairs.length === 0 && (
            <p className="text-[12px] text-[#b09e8d]">No pairs yet — add one per destination.</p>
          )}
          {rrPairs.map((pair, i) => {
            const pairStages = pipelines.find((p) => p.id === pair.pipeline_id)?.stages ?? [];
            return (
              <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-[var(--app-bg)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide">Pair {i + 1}</span>
                  <button type="button" onClick={() => removeRRPair(i)} className="p-1 rounded text-[#b09e8d] hover:text-red-500 hover:bg-red-50 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
                <select value={pair.pipeline_id} onChange={(e) => updateRRPair(i, 'pipeline_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-primary">
                  <option value="">Pipeline…</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {pairStages.length > 0 && (
                  <select value={pair.stage_id} onChange={(e) => updateRRPair(i, 'stage_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-primary">
                    <option value="">Stage (optional)…</option>
                    {pairStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                <select value={pair.staff_id} onChange={(e) => updateRRPair(i, 'staff_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-primary">
                  <option value="">Assign staff…</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            );
          })}
          <button type="button" onClick={addRRPair} className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:opacity-80 transition-opacity">
            <Plus className="w-3.5 h-3.5" /> Add Pair
          </button>
        </div>
      ) : assignMode === 'by_pipeline' ? (
        <div className="space-y-2">
          <label className="block text-[13px] font-semibold text-[#1c1410]">Pipeline → Staff</label>
          {mapping.length === 0 && (
            <p className="text-[12px] text-[#b09e8d]">No rules yet — add a pipeline and the staff to assign.</p>
          )}
          {mapping.map((row, i) => {
            const rowStaffIds: string[] = Array.isArray(row.staff_ids) ? row.staff_ids : (row.staff_id ? [row.staff_id] : []);
            const rowSelected = rowStaffIds.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as StaffOpt[];
            const rowUnselected = staff.filter((s) => !rowStaffIds.includes(s.id));
            return (
              <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={row.pipeline_id} onChange={(e) => updateMappingPipeline(i, e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-primary">
                    <option value="">Pipeline…</option>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => removeMappingRow(i)} className="p-1.5 rounded-lg text-[#b09e8d] hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                  {rowSelected.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 bg-orange-500 text-white text-[11px] font-medium px-2 py-0.5 rounded-md">
                      <button type="button" className="text-white/80 hover:text-white font-bold leading-none" onClick={() => removeStaffFromRow(i, s.id)}>×</button>
                      {s.name}
                    </span>
                  ))}
                  {rowUnselected.length > 0 && (
                    <select value="" onChange={(e) => { if (e.target.value) addStaffToRow(i, e.target.value); }} className="text-[12px] border border-dashed border-gray-300 rounded-md px-2 py-0.5 bg-white outline-none text-[#7a6b5c] cursor-pointer">
                      <option value="">+ Add staff…</option>
                      {rowUnselected.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
                {rowStaffIds.length >= 2 && (
                  <p className="text-[11px] text-[#7a6b5c]">Round-robin across {rowStaffIds.length} staff</p>
                )}
              </div>
            );
          })}
          <button type="button" onClick={addMappingRow} className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:opacity-80 transition-opacity">
            <Plus className="w-3.5 h-3.5" /> Add Rule
          </button>
        </div>
      ) : (
      <>{/* Select Staff */}
      <div>
        <label className="block text-[13px] font-semibold text-[#1c1410] mb-1.5">
          Select Staff <span className="text-red-500">*</span>
        </label>
        <div ref={ref} className="relative">
          <div
            className="min-h-[44px] w-full border border-gray-300 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 cursor-pointer bg-white"
            onClick={() => setOpen((v) => !v)}
          >
            {selectedStaff.length === 0 && (
              <span className="text-[13px] text-gray-400 self-center">Select staff...</span>
            )}
            {selectedStaff.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 bg-orange-500 text-white text-[12px] font-medium px-2.5 py-1 rounded-md"
              >
                <button
                  type="button"
                  className="text-white/80 hover:text-white font-bold leading-none"
                  onClick={(e) => { e.stopPropagation(); removeStaff(s.id); }}
                >×</button>
                {s.name}
              </span>
            ))}
          </div>
          {open && unselected.length > 0 && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-52 overflow-auto">
              {unselected.map((s) => (
                <div
                  key={s.id}
                  className="px-3 py-2 text-[13px] text-[#1c1410] hover:bg-gray-50 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); addStaff(s.id); }}
                >
                  {s.name}
                </div>
              ))}
            </div>
          )}
          {open && unselected.length === 0 && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg py-2 text-center text-[12px] text-gray-400">
              All staff selected
            </div>
          )}
        </div>
      </div>

      {/* Split Traffic — only when 2+ staff */}
      {isMulti && (
        <div>
          <label className="block text-[13px] font-semibold text-[#1c1410] mb-1.5">Split Traffic</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] bg-white outline-none focus:border-primary"
            value={splitMode}
            onChange={(e) => handleSplitModeChange(e.target.value)}
          >
            <option value="evenly">Evenly</option>
            <option value="weighted">Weighted</option>
          </select>
        </div>
      )}

      {/* Traffic distribution — only when 2+ staff */}
      {isMulti && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-[#1c1410]">
            Traffic Weightage
            {splitMode === 'evenly' && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(round-robin — each staff gets equal turns)</span>}
          </p>

          {selectedStaff.map((s) => {
            const evenPct = Math.round(100 / selectedIds.length);
            return (
              <div key={s.id} className="flex items-center gap-3">
                <span className="flex-1 text-[13px] text-[#1c1410] truncate">{s.name}</span>
                {splitMode === 'weighted' ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-[13px] text-center bg-white outline-none focus:border-primary"
                      value={weights[s.id] ?? evenPct}
                      onChange={(e) => setWeight(s.id, Math.max(1, Math.min(99, parseInt(e.target.value) || 0)))}
                    />
                    <span className="text-[13px] text-muted-foreground">%</span>
                  </div>
                ) : (
                  <span className="text-[13px] font-semibold text-primary shrink-0">{evenPct}%</span>
                )}
              </div>
            );
          })}

          {splitMode === 'weighted' && !weightValid && (
            <p className="text-[11px] text-red-500 font-medium">
              Total = {totalWeight}% — must equal 100%
            </p>
          )}
          {splitMode === 'weighted' && weightValid && (
            <p className="text-[11px] text-green-600 font-medium">✓ Weights sum to 100%</p>
          )}
        </div>
      )}

      </>
      )}

      {/* Only unassigned toggle */}
      <div className="flex items-center gap-3">
        <Switch
          checked={!!(cfg.unassignedOnly)}
          onCheckedChange={(v) => onUpdate({ config: { ...cfg, unassignedOnly: v } })}
        />
        <span className="text-[13px] text-[#1c1410]">Only apply to unassigned contacts.</span>
      </div>
    </div>
  );
}

// ── WA Personal Templates Modal ───────────────────────────────────────────────
function WaTemplatesModal({ onClose, onSelect }: { onClose: () => void; onSelect?: (t: WaTemplate) => void }) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editItem, setEditItem] = useState<Partial<WaTemplate> | null>(null);
  const [editName, setEditName] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [preview, setPreview] = useState<WaTemplate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    api.get<WaTemplate[]>('/api/wa-personal-templates').then((rows) => {
      if (Array.isArray(rows)) setTemplates(rows);
    }).catch(() => toast.error('Failed to load templates')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditItem({}); setEditName(''); setEditMessage(''); setEditFile(null); setRemoveFile(false); };
  const openEdit = (t: WaTemplate) => { setEditItem(t); setEditName(t.name); setEditMessage(t.message); setEditFile(null); setRemoveFile(false); };

  const handleSave = async () => {
    if (!editName.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', editName.trim());
      fd.append('message', editMessage);
      if (removeFile) fd.append('removeFile', 'true');
      if (editFile) fd.append('file', editFile);
      const tok = getAccessToken();
      if (editItem?.id) {
        await fetch(`${BASE}/api/wa-personal-templates/${editItem.id}`, { method: 'PATCH', headers: tok ? { Authorization: `Bearer ${tok}` } : {}, credentials: 'include', body: fd });
      } else {
        await fetch(`${BASE}/api/wa-personal-templates`, { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {}, credentials: 'include', body: fd });
      }
      toast.success(editItem?.id ? 'Template updated' : 'Template created');
      setEditItem(null);
      load();
    } catch { toast.error('Save failed'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`${BASE}/api/wa-personal-templates/${id}`, { method: 'DELETE', headers: (() => { const t = getAccessToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })(), credentials: 'include' });
    toast.success('Deleted');
    load();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Paperclip className="w-5 h-5 text-teal-600" />
            <span className="font-bold text-lg">WA Personal Templates</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {editItem !== null ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <h3 className="font-semibold text-base">{editItem.id ? 'Edit Template' : 'New Template'}</h3>
            <div>
              <label className="text-sm font-semibold block mb-1">Name <span className="text-destructive">*</span></label>
              <input className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="e.g. Welcome Message" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Message</label>
              <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/20" value={editMessage} onChange={(e) => setEditMessage(e.target.value)} placeholder="Type message... Supports {first_name}, {last_name}, {phone}, {email}" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Attachment (optional)</label>
              {editItem.id && editItem.file_name && !removeFile && (
                <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
                  <Paperclip className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{editItem.file_name}</span>
                  <button onClick={() => setRemoveFile(true)} className="text-destructive hover:underline text-xs">Remove</button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border rounded-lg hover:bg-muted/30">
                  <Upload className="w-4 h-4" /> {editFile ? editFile.name : 'Choose file'}
                </button>
                {editFile && <button onClick={() => setEditFile(null)} className="text-xs text-muted-foreground hover:underline">Clear</button>}
              </div>
              <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp4,.mp3" onChange={(e) => { setEditFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              <p className="text-xs text-muted-foreground mt-1">Supported: images, PDF, Word, Excel, PowerPoint, ZIP, video, audio. Max 25MB.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button size="sm" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Template'}</Button>
            </div>
          </div>
        ) : preview !== null ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></button>
              <span className="font-semibold">{preview.name}</span>
            </div>
            <div className="bg-muted/20 rounded-xl p-4 text-sm whitespace-pre-wrap">{preview.message || <span className="text-muted-foreground italic">No message text</span>}</div>
            {preview.file_name && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
                <Paperclip className="w-4 h-4" /><span className="truncate">{preview.file_name}</span>
                <span className="text-xs ml-auto">{preview.file_type}</span>
              </div>
            )}
            {onSelect && (
              <Button className="w-full" onClick={() => { onSelect(preview!); onClose(); }}>Use This Template</Button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-muted-foreground">{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
              <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Template</Button>
            </div>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : templates.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No templates yet. Click "New Template" to create one.</div>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 hover:bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{t.message || '(no text)'}{t.file_name ? ` · 📎 ${t.file_name}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onSelect && <button onClick={() => { onSelect(t); onClose(); }} className="text-xs px-2 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-100">Use</button>}
                      <button onClick={() => setPreview(t)} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action Config Panel ────────────────────────────────────────────────────────
function ActionConfigPanel({ node, onUpdate, pipelines, staff, templates, workflows, routingSets, contactGroups, onRefreshPipelines, refreshingPipelines }: {
  node: WFNode;
  onUpdate: (updates: Partial<WFNode>) => void;
  pipelines: PipelineOpt[];
  staff: StaffOpt[];
  templates: TemplateOpt[];
  workflows: { id: string; name: string; status: string }[];
  routingSets?: { id: string; name: string; match_field: string; match_type: string }[];
  contactGroups?: { id: string; name: string }[];
  onRefreshPipelines?: () => void;
  refreshingPipelines?: boolean;
}) {
  const sel = (field: string) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>) =>
    onUpdate({ config: { ...node.config, [field]: e.target.value } });
  const cfg = node.config;
  const actionPipelineStages = pipelines.find(p => p.id === (cfg.pipeline_id as string))?.stages ?? [];
  const customFields = useCrmStore((s) => s.customFields);
  const additionalFields = useCrmStore((s) => s.additionalFields);
  const systemFields = useCrmStore((s) => s.systemFields);
  const valueTokens = useCrmStore((s) => s.valueTokens);

  // WA Personal template state
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [loadingWaTemplates, setLoadingWaTemplates] = useState(false);
  const [showWaTemplatesModal, setShowWaTemplatesModal] = useState(false);
  const [waTemplateMode, setWaTemplateMode] = useState<'write' | 'template'>((cfg.templateId as string) ? 'template' : 'write');

  useEffect(() => {
    if (node.actionType === 'send_whatsapp_personal') {
      setLoadingWaTemplates(true);
      api.get<WaTemplate[]>('/api/wa-personal-templates')
        .then((rows) => { if (Array.isArray(rows)) setWaTemplates(rows); })
        .catch(() => {}).finally(() => setLoadingWaTemplates(false));
    }
  }, [node.actionType]);

  const selectedWaTemplate = Array.isArray(waTemplates) ? waTemplates.find((t) => t.id === (cfg.templateId as string)) : undefined;

  return (
    <div className="space-y-5">

      {/* Add/Update to CRM */}
      {node.actionType === 'add_to_crm' && (<>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold">Select Pipeline</span>
            {onRefreshPipelines && (
              <button onClick={onRefreshPipelines} className="text-[11px] text-primary flex items-center gap-1 hover:underline">
                <RefreshCw className={`w-3 h-3 ${refreshingPipelines ? 'animate-spin' : ''}`} />
                {refreshingPipelines ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>
          <select className={selectCls} value={(cfg.pipeline_id as string) ?? ''} onChange={sel('pipeline_id')}>
            <option value="">Choose pipeline...</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <FieldRow label="Select Pipeline Stage">
          <select className={selectCls} value={(cfg.stage_id as string) ?? ''} onChange={sel('stage_id')}>
            <option value="">Select stage...</option>
            {actionPipelineStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FieldRow>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold block">Only if lead has no pipeline</span>
            <span className="text-xs text-muted-foreground">Skip this step if the lead is already in a pipeline (use as fallback)</span>
          </div>
          <Switch checked={!!(cfg.only_if_no_pipeline)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, only_if_no_pipeline: v } })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Skip Lead Value Change</span>
          <Switch checked={!!(cfg.skipLeadValue)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, skipLeadValue: v } })} />
        </div>
        <FieldRow label="Deal Value">
          <input type="number" className={inputCls} value={(cfg.deal_value as string) ?? ''} onChange={sel('deal_value')} min="0" placeholder="0" />
        </FieldRow>
      </>)}

      {/* Assign To AI Agent */}
      {node.actionType === 'assign_ai' && (<>
        <p className="text-sm text-muted-foreground">Assign this contact to an AI agent to handle communication automatically.</p>
        <FieldRow label="Select AI Agent" required>
          <select className={selectCls} value={(cfg.agentId as string) ?? ''} onChange={sel('agentId')}>
            <option value="">Choose an AI agent...</option>
            {AI_AGENTS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </FieldRow>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold block">Hand off to human on reply</span>
            <span className="text-xs text-muted-foreground">Notify assigned staff when contact replies</span>
          </div>
          <Switch checked={!!(cfg.handoff)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, handoff: v } })} />
        </div>
      </>)}

      {/* Assign To Staff */}
      {node.actionType === 'assign_staff' && (
        <AssignStaffPanel cfg={cfg} staff={staff} pipelines={pipelines} onUpdate={onUpdate} />
      )}

      {/* Change Appointment Status */}
      {node.actionType === 'change_appointment' && (<>
        <p className="text-sm text-foreground">
          <span className="font-semibold">Note:</span> This operation only works with Appointment Automations.
        </p>
        <FieldRow label="Select Status">
          <select className={selectCls} value={(cfg.status as string) ?? ''} onChange={sel('status')}>
            <option value="">Choose status...</option>
            {APPT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </FieldRow>
      </>)}

      {/* Change Lead Quality */}
      {node.actionType === 'change_lead_quality' && (
        <FieldRow label="Select Lead Quality" required>
          <select className={selectCls} value={(cfg.quality as string) ?? ''} onChange={sel('quality')}>
            <option value="">Select quality...</option>
            {LEAD_QUALITIES.map((q) => <option key={q}>{q}</option>)}
          </select>
        </FieldRow>
      )}

      {/* Contact Group Access (deprecated) */}
      {node.actionType === 'contact_group_access' && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">This action is deprecated</p>
            <p className="text-xs text-amber-700 mt-1">Contact Group Access no longer has any effect. Replace this node with the <strong>Contact Group</strong> action to add, move, or remove contacts from a group.</p>
          </div>
        </div>
      )}

      {/* Contact Group */}
      {node.actionType === 'broadcast_group' && (<>
        <FieldRow label="Contact Group" required hint="All members will receive the actions after this node.">
          <select className={selectCls} value={(cfg.group_id as string) ?? ''} onChange={sel('group_id')}>
            <option value="">Select a group...</option>
            {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldRow>
        {!(cfg.group_id) && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800"><span className="font-semibold">No group selected.</span> This action will be skipped.</p>
          </div>
        )}
        <FieldRow label="Interval between each message" required>
          <div className="flex gap-2">
            <input
              type="number" min={1} max={3600}
              className="w-20 border border-border rounded-lg px-3 py-2 text-sm bg-card outline-none focus:border-primary/50"
              value={Number(cfg.interval_value ?? 2)}
              onChange={(e) => onUpdate({ config: { ...cfg, interval_value: e.target.value } })}
            />
            <select className={selectCls} value={(cfg.interval_unit as string) ?? 'minutes'} onChange={sel('interval_unit')}>
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </div>
        </FieldRow>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">Actions placed after this node will run for each group member with the interval set above. Pair with <strong>Specific Date</strong> trigger to schedule automatically.</p>
        </div>
      </>)}

      {node.actionType === 'contact_group' && (<>
        {(cfg.targetList && !(cfg.group_id as string)) && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-1">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800"><span className="font-semibold">Reconfiguration required.</span> This action was set up before Contact Groups existed. Select a group below to re-activate it.</p>
          </div>
        )}
        <FieldRow label="Action">
          <select className={selectCls} value={(cfg.groupAction as string) ?? 'add'} onChange={sel('groupAction')}>
            <option value="add">Add to group</option>
            <option value="move">Move to group</option>
            <option value="remove">Remove from group</option>
          </select>
        </FieldRow>
        {(cfg.groupAction as string) === 'move' && (
          <FieldRow label="From group (optional)" hint="Leave blank to remove from all groups before moving.">
            <select className={selectCls} value={(cfg.source_group_id as string) ?? ''} onChange={sel('source_group_id')}>
              <option value="">All groups (sweep)</option>
              {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </FieldRow>
        )}
        <FieldRow label={(cfg.groupAction as string) === 'remove' ? 'Remove from group' : 'Target group'} required>
          <select className={selectCls} value={(cfg.group_id as string) ?? ''} onChange={sel('group_id')}>
            <option value="">Choose a group...</option>
            {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldRow>
        {!(cfg.group_id as string) && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">No group selected — this action will be skipped at runtime.</p>
          </div>
        )}
      </>)}

      {/* Change Pipeline Stage */}
      {node.actionType === 'change_stage' && (<>
        <FieldRow label="Select Pipeline">
          <select className={selectCls} value={(cfg.pipeline_id as string) ?? ''} onChange={sel('pipeline_id')}>
            <option value="">Any pipeline</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Move To Stage">
          <select className={selectCls} value={(cfg.stage_id as string) ?? ''} onChange={sel('stage_id')}>
            <option value="">Select stage...</option>
            {actionPipelineStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FieldRow>
      </>)}

      {/* Add Tag / Tag Contact */}
      {(node.actionType === 'add_tag' || node.actionType === 'tag_contact') && (
        <FieldRow label="Tags to Add" required hint="Press Enter or comma after each tag to add multiple.">
          <TagChipInput
            tags={(cfg.tags as string[]) ?? (cfg.tag ? [(cfg.tag as string)] : [])}
            onChange={(tags) => onUpdate({ config: { ...cfg, tags, tag: tags[0] ?? '' } })}
            placeholder="Type a tag and press Enter…"
          />
        </FieldRow>
      )}

      {/* Remove Tag */}
      {node.actionType === 'remove_tag' && (
        <FieldRow label="Tags to Remove" hint="Press Enter or comma after each tag to remove multiple.">
          <TagChipInput
            tags={(cfg.tags as string[]) ?? (cfg.tag ? [(cfg.tag as string)] : [])}
            onChange={(tags) => onUpdate({ config: { ...cfg, tags, tag: tags[0] ?? '' } })}
            placeholder="Type a tag and press Enter…"
          />
        </FieldRow>
      )}

      {/* Remove Contact */}
      {node.actionType === 'remove_contact' && (<>
        {(cfg.targetList && !(cfg.group_id as string)) && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-1">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800"><span className="font-semibold">Reconfiguration required.</span> Select a Contact Group below to re-activate this action.</p>
          </div>
        )}
        <FieldRow label="Remove from Group" required>
          <select className={selectCls} value={(cfg.group_id as string) ?? ''} onChange={sel('group_id')}>
            <option value="">Choose a group...</option>
            {(contactGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldRow>
        {!(cfg.group_id as string) && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">No group selected — this action will be skipped at runtime.</p>
          </div>
        )}
      </>)}

      {/* Execute Automation */}
      {node.actionType === 'execute_automation' && (() => {
        const selectedWf = workflows.find((w) => w.id === (cfg.workflow_id as string));
        return (<>
          <FieldRow label="Select Workflow">
            <select className={selectCls} value={(cfg.workflow_id as string) ?? ''} onChange={sel('workflow_id')}>
              <option value="">Choose workflow to run...</option>
              {workflows.length === 0
                ? <option disabled>No other workflows found</option>
                : workflows.map((w) => <option key={w.id} value={w.id}>{w.name}{w.status === 'draft' ? ' (draft)' : ''}</option>)
              }
            </select>
          </FieldRow>
          {selectedWf?.status === 'draft' && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800"><span className="font-semibold">"{selectedWf.name}" is a draft.</span> It will still execute when called, but consider activating it.</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Wait for completion</span>
            <Switch checked={!!(cfg.waitForCompletion)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, waitForCompletion: v } })} />
          </div>
        </>);
      })()}

      {/* Update Attributes */}
      {node.actionType === 'update_attributes' && (() => {
        const [varPickerOpen, setVarPickerOpen] = useState(false);
        const [varTab, setVarTab] = useState<string>(systemFields[0]?.group ?? 'Contact');

        const systemGroups = Array.from(new Set(systemFields.map((f) => f.group)));
        const EXCLUDED_UA = new Set(['assigned_to_staff']);
        const slugifyTokenUa = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
        const uaTabs = [
          ...systemGroups.filter((g) => g !== 'CRM').map((group) => ({
            id: group,
            label: group,
            fields: systemFields
              .filter((f) => f.group === group && !EXCLUDED_UA.has(f.slug))
              .map((f) => ({ name: f.name, variable: `{%${f.slug}%}` })),
          })),
          {
            id: 'CRM',
            label: 'CRM',
            fields: [
              { name: 'Pipeline',        variable: '{pipeline}' },
              { name: 'Stage',           variable: '{stage}' },
              { name: 'Assigned Staff',  variable: '{assigned_staff}' },
              { name: 'Staff ID',        variable: '{assigned_staff_id}' },
              { name: 'Source',          variable: '{source}' },
              { name: 'Created At',      variable: '{created_at}' },
            ],
          },
          {
            id: 'Custom',
            label: 'Custom',
            fields: customFields.map((f) => ({ name: f.name, variable: `{%${f.slug}%}` })),
          },
          {
            id: 'Values',
            label: 'Values',
            fields: valueTokens.map((v) => ({ name: v.name, variable: `{%${slugifyTokenUa(v.name)}%}` })),
          },
        ];

        const insertVar = (variable: string) => {
          onUpdate({ config: { ...cfg, attrValue: variable } });
          setVarPickerOpen(false);
        };

        return (<>
          <p className="text-sm text-muted-foreground">Set a specific field on this contact to a fixed or dynamic value.</p>
          <FieldRow label="Field to Update" required>
            <select className={selectCls} value={(cfg.attrField as string) ?? ''} onChange={sel('attrField')}>
              <option value="">Select field...</option>
              <option value="name">Full Name</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="source">Source</option>
              <option value="lead_quality">Lead Quality</option>
              <option value="deal_value">Deal Value</option>
              <option value="assigned_to">Assigned To (Staff ID)</option>
              {customFields.length > 0 && customFields.map((f) => (
                <option key={f.id} value={`custom:${f.slug}`}>{f.name}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="New Value" required>
            <div>
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Type a fixed value or pick a variable →"
                  value={(cfg.attrValue as string) ?? ''}
                  onChange={sel('attrValue')}
                />
                <button
                  type="button"
                  onClick={() => setVarPickerOpen(true)}
                  className="px-3 py-2 rounded-lg border border-border text-[12px] font-semibold text-primary hover:bg-primary/5 whitespace-nowrap"
                >
                  Variables
                </button>
              </div>
              {varPickerOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setVarPickerOpen(false)}>
                  <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[500px] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-4 border-b">
                      <h3 className="font-bold text-[15px]">Custom Values</h3>
                      <button type="button" onClick={() => setVarPickerOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex px-2 gap-1 overflow-x-auto shrink-0">
                      {uaTabs.map((tab) => (
                        <button key={tab.id} type="button"
                          onClick={() => setVarTab(tab.id)}
                          className={`text-xs font-semibold px-3 py-2 whitespace-nowrap transition-colors ${varTab === tab.id ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'}`}>
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div className="border-b" />
                    <div className="flex-1 overflow-y-auto p-2">
                      {(uaTabs.find((t) => t.id === varTab)?.fields ?? []).map((f) => (
                        <button key={f.variable} type="button"
                          onClick={() => insertVar(f.variable)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 rounded-lg flex items-center justify-between group">
                          <span className="text-[13px] text-gray-800">{f.name}</span>
                          <span className="text-[11px] font-mono text-gray-400 group-hover:text-primary">{f.variable}</span>
                        </button>
                      ))}
                      {(uaTabs.find((t) => t.id === varTab)?.fields.length ?? 0) === 0 && (
                        <p className="text-xs text-gray-400 text-center py-6">No fields in this category</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </FieldRow>
        </>);
      })()}

      {/* Create Follow-up */}
      {node.actionType === 'create_followup' && (<>
        <FieldRow label="Follow-up Title" required>
          <input className={inputCls} placeholder="e.g. Follow up with lead" value={(cfg.title as string) ?? ''} onChange={sel('title')} />
        </FieldRow>
        <FieldRow label="Type">
          <select className={selectCls} value={(cfg.followupType as string) ?? ''} onChange={sel('followupType')}>
            <option value="">Select type...</option>
            {FOLLOWUP_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Due Date Offset">
          <div className="flex gap-2">
            <input type="number" className="w-24 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none" value={(cfg.dueDays as string) ?? '1'} onChange={sel('dueDays')} min="0" />
            <select className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={(cfg.dueUnit as string) ?? 'days'} onChange={sel('dueUnit')}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        </FieldRow>
        <FieldRow label="Notes (optional)">
          <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={3} placeholder="Add notes for the follow-up..." value={(cfg.notes as string) ?? ''} onChange={sel('notes')} />
        </FieldRow>
      </>)}

      {/* Add Note */}
      {node.actionType === 'create_note' && (<>
        <FieldRow label="Note Content" required>
          <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={5} placeholder="Call {first_name} at {phone} to discuss next steps..." value={(cfg.noteContent as string) ?? ''} onChange={sel('noteContent')} />
          <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, noteContent: ((cfg.noteContent as string) ?? '') + v } })} />
        </FieldRow>
        <FieldRow label="Visibility">
          <select className={selectCls} value={(cfg.noteVisibility as string) ?? 'private'} onChange={sel('noteVisibility')}>
            <option value="private">Private (only assigned staff)</option>
            <option value="team">Team (all staff)</option>
          </select>
        </FieldRow>
      </>)}

      {/* Event Start Time */}
      {node.actionType === 'event_start_time' && (
        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
            <p className="text-xs text-orange-800 flex items-start gap-1.5">
              <PlayCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This action triggers at the exact start time of a scheduled event or webinar. No further configuration needed.
            </p>
          </div>
          <FieldRow label="Event">
            <select className={selectCls} value={(cfg.eventId as string) ?? ''} onChange={sel('eventId')}>
              <option value="">Select event...</option>
              <option value="evt1">Sales Webinar — April 20</option>
              <option value="evt2">Product Launch — May 5</option>
              <option value="evt3">Training Workshop — May 15</option>
            </select>
          </FieldRow>
        </div>
      )}

      {/* Internal Notification */}
      {node.actionType === 'internal_notify' && (<>
        <p className="text-sm text-muted-foreground leading-relaxed">Send a notification to your team member when a contact reaches this step.</p>
        <FieldRow label="Action Name">
          <input className={inputCls} value={(cfg.actionName as string) ?? 'Internal Notification'} onChange={sel('actionName')} />
        </FieldRow>
        <FieldRow label="Type of Notification">
          <select className={selectCls} value={(cfg.notifType as string) ?? 'in_app'} onChange={sel('notifType')}>
            <option value="in_app">In App (Bell notification)</option>
          </select>
        </FieldRow>
        <FieldRow label="Send To">
          <select className={selectCls} value={(cfg.sendTo as string) ?? ''} onChange={sel('sendTo')}>
            <option value="">Select whom to notify</option>
            <option value="assigned">Assigned Staff</option>
            <option value="all">All Staff</option>
            <option value="specific">Specific Staff</option>
          </select>
        </FieldRow>
        {(cfg.sendTo as string) === 'specific' && (
          <FieldRow label="Select Staff">
            <select className={selectCls} value={(cfg.staff_id as string) ?? ''} onChange={sel('staff_id')}>
              <option value="">Choose staff member...</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </FieldRow>
        )}
        <FieldRow label="Message">
          <div>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={3} placeholder="Notification: {first_name} moved to {stage}..." value={(cfg.message as string) ?? ''} onChange={sel('message')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, message: ((cfg.message as string) ?? '') + v } })} />
          </div>
        </FieldRow>
      </>)}

      {/* Send Email */}
      {node.actionType === 'send_email' && (<>
        <p className="text-sm text-muted-foreground leading-relaxed">Send an automated email to contacts who reach this step.</p>
        <FieldRow label="To Email" required>
          <div>
            <input className={inputCls} placeholder="Leave blank to use contact's email, or {email}" value={(cfg.to as string) ?? ''} onChange={sel('to')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, to: ((cfg.to as string) ?? '') + v } })} />
          </div>
        </FieldRow>
        <FieldRow label="From Name">
          <input className={inputCls} placeholder="E.g. Your Company Name" value={(cfg.fromName as string) ?? ''} onChange={sel('fromName')} />
        </FieldRow>
        <FieldRow label="Email Subject" required>
          <div>
            <input className={inputCls} placeholder="E.g. Welcome, {first_name}!" value={(cfg.subject as string) ?? ''} onChange={sel('subject')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, subject: ((cfg.subject as string) ?? '') + v } })} />
          </div>
        </FieldRow>
        <FieldRow label="Reply To">
          <input className={inputCls} placeholder="Reply to email address" value={(cfg.replyTo as string) ?? ''} onChange={sel('replyTo')} />
        </FieldRow>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold">Content</label>
          </div>
          <div className="border border-border rounded-t-lg bg-gray-50 px-2 py-1.5 flex items-center gap-1 flex-wrap text-xs text-gray-600">
            {['↩', '↪', 'B', 'I', 'U', 'H1', '¶', 'A', '—', '🔗'].map((t) => (
              <button key={t} className="px-1.5 py-0.5 rounded hover:bg-gray-200 font-medium transition-colors">{t}</button>
            ))}
            <select className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white outline-none ml-1">
              <option>Paragraph</option><option>Heading 1</option><option>Heading 2</option>
            </select>
          </div>
          <textarea
            className="w-full border border-t-0 border-border rounded-b-lg px-3 py-2 text-sm bg-card outline-none resize-none min-h-32"
            rows={5}
            placeholder="Hi {first_name}, thank you for your interest..."
            value={(cfg.body as string) ?? (cfg.content as string) ?? ''}
            onChange={(e) => onUpdate({ config: { ...cfg, body: e.target.value, content: e.target.value } })}
          />
          <VarHints onInsert={(v) => {
            const cur = (cfg.body as string) ?? (cfg.content as string) ?? '';
            onUpdate({ config: { ...cfg, body: cur + v, content: cur + v } });
          }} />
        </div>
      </>)}

      {/* Send SMS */}
      {node.actionType === 'send_sms' && (<>
        <p className="text-sm text-muted-foreground leading-relaxed">Send an automated SMS to contacts who reach this step.</p>
        <FieldRow label="Action Name">
          <input className={inputCls} value={(cfg.actionName as string) ?? 'Send SMS'} onChange={sel('actionName')} />
        </FieldRow>
        <FieldRow label="Message">
          <div>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={4} placeholder="Hi {first_name}, your appointment is confirmed!" value={(cfg.message as string) ?? ''} onChange={sel('message')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, message: ((cfg.message as string) ?? '') + v } })} />
          </div>
        </FieldRow>
        <FieldRow label="From Number">
          <select className={selectCls} value={(cfg.fromNumber as string) ?? ''} onChange={sel('fromNumber')}>
            <option value="">Use default number</option>
            <option>+91 98765 43210</option>
            <option>+91 91234 56789</option>
          </select>
        </FieldRow>
      </>)}

      {/* WhatsApp Message */}
      {node.actionType === 'send_whatsapp' && (<>
        <p className="text-sm text-muted-foreground leading-relaxed">Send an automated WhatsApp message to contacts at this step.</p>
        <FieldRow label="Select Template" required>
          {templates.length === 0 ? (
            <div className="border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground bg-muted/40">
              No templates found. Create templates in Settings → WhatsApp Templates.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-48 overflow-y-auto bg-white">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onUpdate({ config: { ...cfg, template: t.name, template_id: t.id, message: t.body ?? t.name } })}
                    className={cn(
                      'w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-0 transition-colors',
                      (cfg.template_id as string) === t.id
                        ? 'bg-red-50 text-red-700 font-medium'
                        : 'hover:bg-gray-50 text-gray-700'
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </FieldRow>
      </>)}

      {/* WhatsApp Personal */}
      {node.actionType === 'send_whatsapp_personal' && (<>
        {showWaTemplatesModal && (
          <WaTemplatesModal
            onClose={() => { setShowWaTemplatesModal(false); setLoadingWaTemplates(true); api.get<WaTemplate[]>('/api/wa-personal-templates').then((rows) => { if (Array.isArray(rows)) setWaTemplates(rows); }).catch(() => {}).finally(() => setLoadingWaTemplates(false)); }}
            onSelect={(t) => { onUpdate({ config: { ...cfg, templateId: t.id, message: undefined } }); setWaTemplateMode('template'); }}
          />
        )}
        <p className="text-sm text-muted-foreground leading-relaxed">Send a message via your connected personal WhatsApp session (QR scan). Requires an active personal WA connection in Integrations.</p>

        {/* Source toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            className={cn('flex-1 py-2 font-medium transition-colors', waTemplateMode === 'write' ? 'bg-teal-600 text-white' : 'bg-white text-muted-foreground hover:bg-muted/30')}
            onClick={() => { setWaTemplateMode('write'); onUpdate({ config: { ...cfg, templateId: undefined } }); }}
          >Write Message</button>
          <button
            className={cn('flex-1 py-2 font-medium transition-colors', waTemplateMode === 'template' ? 'bg-teal-600 text-white' : 'bg-white text-muted-foreground hover:bg-muted/30')}
            onClick={() => { setWaTemplateMode('template'); onUpdate({ config: { ...cfg, message: undefined } }); }}
          >Use Template</button>
        </div>

        {waTemplateMode === 'write' ? (
          <FieldRow label="Message" required>
            <textarea
              className="w-full border border-border rounded-lg px-3 py-2 text-sm min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
              placeholder="Type your message... Supports variables: {first_name}, {last_name}, {phone}, {email}"
              value={(cfg.message as string) ?? ''}
              onChange={(e) => onUpdate({ config: { ...cfg, message: e.target.value } })}
            />
          </FieldRow>
        ) : (
          <FieldRow label="Template" required>
            <div className="space-y-2">
              {loadingWaTemplates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" />Loading templates…</div>
              ) : waTemplates.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">No templates yet.</div>
              ) : (
                <select
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                  value={(cfg.templateId as string) ?? ''}
                  onChange={(e) => onUpdate({ config: { ...cfg, templateId: e.target.value } })}
                >
                  <option value="">— Select a template —</option>
                  {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {selectedWaTemplate && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-teal-700">{selectedWaTemplate.name}</div>
                  {selectedWaTemplate.message && <div className="text-xs text-teal-800 whitespace-pre-wrap">{selectedWaTemplate.message}</div>}
                  {selectedWaTemplate.file_name && (
                    <div className="flex items-center gap-1.5 text-xs text-teal-600 mt-1">
                      <Paperclip className="w-3 h-3" /><span>{selectedWaTemplate.file_name}</span>
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => setShowWaTemplatesModal(true)} className="flex items-center gap-1.5 text-xs text-teal-700 hover:underline font-medium">
                <Settings className="w-3.5 h-3.5" />Manage Templates
              </button>
            </div>
          </FieldRow>
        )}

        <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700">
          <span className="shrink-0 mt-0.5">ℹ️</span>
          <span>Messages are sent from your personal WhatsApp account. They are not formal templates and do not require Meta approval.</span>
        </div>
      </>)}

      {/* Time Delay */}
      {node.actionType === 'delay' && (() => {
        const preset    = (cfg.preset    as string)   ?? '24h';
        const direction = (cfg.direction as string)   ?? 'after';
        const isCustom  = preset === 'custom';
        const useAdvWindow = !!(cfg.useAdvancedWindow);
        const windowDays   = (cfg.windowDays as string[]) ?? ['mon','tue','wed','thu','fri'];
        const PRESET_LABELS: Record<string, string> = {
          '24h':'24 hours','12h':'12 hours','4h':'4 hours',
          '60m':'60 minutes','30m':'30 minutes','15m':'15 minutes','5m':'5 minutes','custom':'Custom',
        };
        const buildLabel = (dir: string, p: string) =>
          dir === 'after' ? `Wait ${PRESET_LABELS[p] ?? p}` : `Before ${PRESET_LABELS[p] ?? p}`;
        const handlePreset = (e: React.ChangeEvent<HTMLSelectElement>) =>
          onUpdate({ config: { ...cfg, preset: e.target.value }, label: buildLabel(direction, e.target.value) });
        const handleDirection = (e: React.ChangeEvent<HTMLSelectElement>) =>
          onUpdate({ config: { ...cfg, direction: e.target.value }, label: buildLabel(e.target.value, preset) });

        return (<>
          <FieldRow label="Timing">
            <div className="flex gap-2">
              <select
                className="w-28 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none"
                value={direction} onChange={handleDirection}
              >
                <option value="after">After</option>
                <option value="before">Before</option>
              </select>
              <select
                className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none"
                value={preset} onChange={handlePreset}
              >
                <option value="24h">24 hours</option>
                <option value="12h">12 hours</option>
                <option value="4h">4 hours</option>
                <option value="60m">60 minutes</option>
                <option value="30m">30 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="5m">5 minutes</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </FieldRow>

          {isCustom && (
            <FieldRow label="Custom Duration">
              <div className="flex gap-2">
                <input
                  type="number" min="1"
                  className="w-24 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none"
                  value={(cfg.customValue as string) ?? '1'} onChange={sel('customValue')}
                />
                <select
                  className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none"
                  value={(cfg.customUnit as string) ?? 'hours'} onChange={sel('customUnit')}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </FieldRow>
          )}

          <div className="flex items-center gap-3 py-1">
            <Switch checked={useAdvWindow} onCheckedChange={(v) => onUpdate({ config: { ...cfg, useAdvancedWindow: v } })} />
            <span className="text-sm text-foreground font-medium">Use Advanced Time Window</span>
          </div>

          {useAdvWindow && (<>
            <FieldRow label="Active Hours">
              <div className="flex items-center gap-2">
                <input type="time" className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none" value={(cfg.windowStart as string) ?? '09:00'} onChange={sel('windowStart')} />
                <span className="text-sm text-muted-foreground">to</span>
                <input type="time" className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:border-primary outline-none" value={(cfg.windowEnd as string) ?? '18:00'} onChange={sel('windowEnd')} />
              </div>
            </FieldRow>
            <FieldRow label="Active Days">
              <div className="flex flex-wrap gap-2">
                {(['mon','tue','wed','thu','fri','sat','sun'] as const).map((d) => {
                  const DAY_LBL: Record<string,string> = {mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun'};
                  const active = windowDays.includes(d);
                  return (
                    <button key={d} type="button"
                      onClick={() => { const next = active ? windowDays.filter((x:string)=>x!==d) : [...windowDays,d]; onUpdate({config:{...cfg,windowDays:next}}); }}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors', active ? 'bg-primary text-white border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/40')}
                    >
                      {DAY_LBL[d]}
                    </button>
                  );
                })}
              </div>
            </FieldRow>
          </>)}
        </>);
      })()}

      {/* Instagram DM */}
      {node.actionType === 'post_instagram' && (<>
        <p className="text-sm text-muted-foreground">Send a direct message on Instagram to this contact.</p>
        <FieldRow label="Instagram Account">
          <select className={selectCls} value={(cfg.igAccount as string) ?? ''} onChange={sel('igAccount')}>
            <option value="">Select account...</option>
            {/* Facebook pages loaded via Meta integration */}
          </select>
        </FieldRow>
        <FieldRow label="Select Template">
          <select className={selectCls} value={(cfg.template as string) ?? ''} onChange={sel('template')}>
            <option value="">Select template...</option>
            {INSTAGRAM_TEMPLATES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Or write message">
          <div>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={3} placeholder="Hi {first_name}, thanks for reaching out..." value={(cfg.message as string) ?? ''} onChange={sel('message')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, message: ((cfg.message as string) ?? '') + v } })} />
          </div>
        </FieldRow>
      </>)}

      {/* Facebook Comment Reply */}
      {node.actionType === 'facebook_post' && (<>
        <p className="text-sm text-muted-foreground">Reply to a Facebook comment automatically.</p>
        <FieldRow label="Facebook Page">
          <select className={selectCls} value={(cfg.page as string) ?? ''} onChange={sel('page')}>
            <option value="">Select page...</option>
            {/* Facebook pages loaded via Meta integration */}
          </select>
        </FieldRow>
        <FieldRow label="Reply Template">
          <select className={selectCls} value={(cfg.template as string) ?? ''} onChange={sel('template')}>
            <option value="">Select template...</option>
            {FB_TEMPLATES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Or write reply">
          <div>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={3} placeholder="Hi {first_name}, thanks for your comment!" value={(cfg.message as string) ?? ''} onChange={sel('message')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, message: ((cfg.message as string) ?? '') + v } })} />
          </div>
        </FieldRow>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Also send DM</span>
          <Switch checked={!!(cfg.alsoSendDm)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, alsoSendDm: v } })} />
        </div>
      </>)}

      {/* Webhook Call */}
      {node.actionType === 'webhook_call' && (() => {
        type KV = { key: string; value: string };
        const DEFAULT_BODY: KV[] = [];
        const bodyFields: KV[]   = (cfg.body_fields as KV[] | undefined) ?? DEFAULT_BODY;
        const headerFields: KV[] = (cfg.header_fields as KV[]) ?? [];
        const webhookType        = (cfg.webhook_type as string)  ?? 'realtime';
        const requestFormat      = (cfg.request_format as string) ?? 'json';
        const method             = (cfg.method as string) ?? 'POST';
        const hasBody            = ['POST','PUT','PATCH'].includes(method);

        const updateBodyFields   = (fields: KV[]) => onUpdate({ config: { ...cfg, body_fields: fields } });
        const updateHeaderFields = (fields: KV[]) => onUpdate({ config: { ...cfg, header_fields: fields } });
        const addRow    = (fields: KV[], setFn: (f: KV[]) => void) => setFn([...fields, { key: '', value: '' }]);
        const updateRow = (fields: KV[], setFn: (f: KV[]) => void, idx: number, patch: Partial<KV>) => setFn(fields.map((r, i) => i === idx ? { ...r, ...patch } : r));
        const removeRow = (fields: KV[], setFn: (f: KV[]) => void, idx: number) => setFn(fields.filter((_, i) => i !== idx));
        const bodyMode  = (cfg.body_mode as string) ?? 'fields';
        const rawPayload = (cfg.payload as string) ?? '';
        const updateBodyMode = (mode: string) => onUpdate({ config: { ...cfg, body_mode: mode } });

        // Custom Values modal state
        const [cvOpen, setCvOpen] = useState<{ section: 'body'|'header'; idx: number } | null>(null);
        const [cvTab, setCvTab]   = useState<string>(systemFields[0]?.group ?? 'Contact');

        // Build tabs dynamically — all data fetched from API via store (no frontend constants)
        const systemGroups = Array.from(new Set(systemFields.map((f) => f.group)));
        // assigned_to_staff is excluded from Contact tab — CRM tab covers it via {assigned_staff}
        const EXCLUDED_SLUGS = new Set(['assigned_to_staff']);
        const slugifyToken = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
        const cvTabs = [
          // CRM-group system fields render as their own CRM tab below; exclude here to avoid duplication
          ...systemGroups.filter((g) => g !== 'CRM').map((group) => ({
            id: group,
            label: group,
            fields: systemFields
              .filter((f) => f.group === group && !EXCLUDED_SLUGS.has(f.slug))
              .map((f) => ({ name: f.name, variable: `{%${f.slug}%}` })),
          })),
          {
            id: 'CRM',
            label: 'CRM',
            fields: [
              { name: 'Pipeline',        variable: '{pipeline}' },
              { name: 'Stage',           variable: '{stage}' },
              { name: 'Assigned Staff',  variable: '{assigned_staff}' },
              { name: 'Staff ID',        variable: '{assigned_staff_id}' },
              { name: 'Source',          variable: '{source}' },
              { name: 'Created At',      variable: '{created_at}' },
              { name: 'Form Name',       variable: '{form_name}' },
            ],
          },
          {
            id: 'Custom',
            label: 'Custom',
            fields: customFields.map((f) => ({ name: f.name, variable: `{%${f.slug}%}` })),
          },
          // Values created in Fields → Values (e.g. Platform → {%platform%})
          {
            id: 'Values',
            label: 'Values',
            fields: valueTokens.map((v) => ({ name: v.name, variable: `{%${slugifyToken(v.name)}%}` })),
          },
        ];

        const insertVariable = (name: string, variable: string) => {
          if (!cvOpen) return;
          const fields = cvOpen.section === 'body' ? bodyFields : headerFields;
          const setFn  = cvOpen.section === 'body' ? updateBodyFields : updateHeaderFields;
          const currentKey = fields[cvOpen.idx]?.key ?? '';
          updateRow(fields, setFn, cvOpen.idx, {
            value: variable,
            key: currentKey || name,  // fill key only if it's empty
          });
          setCvOpen(null);
        };

        return (<>
          {/* HTTP Method */}
          <div>
            <label className="text-[13px] font-semibold text-gray-700 block mb-1.5">HTTP Method</label>
            <select className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none bg-white" value={method} onChange={sel('method')}>
              <option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option>
            </select>
          </div>

          {/* Endpoint */}
          <div>
            <label className="text-[13px] font-semibold text-gray-700 block mb-1.5">Endpoint</label>
            <input type="url" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-gray-400"
              value={(cfg.url as string) ?? ''} onChange={sel('url')}
              placeholder="https://n8n.srv932301.hstgr.cloud/webhook-test/..." />
          </div>

          {/* Webhook Type — full-width stacked cards */}
          <div>
            <label className="text-[13px] font-semibold text-gray-700 block mb-2">Webhook Type</label>
            <div className="space-y-2">
              {/* Real-Time */}
              {(() => {
                const isSelected = webhookType === 'realtime';
                const [expanded, setExpanded] = useState(false);
                return (
                  <div onClick={() => onUpdate({ config: { ...cfg, webhook_type: 'realtime' } })}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${isSelected ? 'border-green-500 bg-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
                          <Zap className="w-4 h-4 text-green-600" />
                        </div>
                        <div>
                          <p className={`text-[14px] font-bold ${isSelected ? 'text-green-600' : 'text-gray-800'}`}>Real-Time Webhook</p>
                          <p className="text-[12px] text-gray-500 mt-0.5">Triggers immediately when the workflow reaches this step.</p>
                          <div className="flex gap-3 mt-2">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                              className="text-[11px] text-green-600 font-semibold flex items-center gap-0.5 hover:underline">
                              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                              How it works
                            </button>
                          </div>
                          {expanded && (
                            <div className="mt-2 text-[11px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
                              When the workflow reaches this step, it immediately sends an HTTP request to your endpoint without any delay. Best for real-time notifications and instant integrations.
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${isSelected ? 'border-green-500 bg-green-500' : 'border-gray-300'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Time-Aware */}
              {(() => {
                const isSelected = webhookType === 'time_aware';
                const [expanded, setExpanded] = useState(false);
                return (
                  <div onClick={() => onUpdate({ config: { ...cfg, webhook_type: 'time_aware' } })}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${isSelected ? 'border-orange-400 bg-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center shrink-0 mt-0.5">
                          <Clock className="w-4 h-4 text-orange-500" />
                        </div>
                        <div>
                          <p className={`text-[14px] font-bold ${isSelected ? 'text-orange-500' : 'text-gray-800'}`}>Time-Aware Webhook</p>
                          <p className="text-[12px] text-gray-500 mt-0.5">Triggers only if the action is within the allowed time window.</p>
                          <div className="flex gap-3 mt-2">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                              className="text-[11px] text-orange-500 font-semibold flex items-center gap-0.5 hover:underline">
                              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                              How it works
                            </button>
                          </div>
                          {expanded && (
                            <div className="mt-2 text-[11px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
                              The webhook only fires during your configured hours and days. Outside that window, this step is skipped and logged as "skipped (outside time window)".
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${isSelected ? 'border-orange-400 bg-orange-400' : 'border-gray-300'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Time window (only if time_aware) */}
          {webhookType === 'time_aware' && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-orange-800">Allowed Time Window</p>
              <div className="flex items-center gap-2">
                <input type="time" className="border border-orange-200 bg-white rounded-lg px-2 py-1.5 text-[13px] outline-none"
                  value={(cfg.time_start as string) ?? '09:00'}
                  onChange={(e) => onUpdate({ config: { ...cfg, time_start: e.target.value } })} />
                <span className="text-[12px] text-gray-500">to</span>
                <input type="time" className="border border-orange-200 bg-white rounded-lg px-2 py-1.5 text-[13px] outline-none"
                  value={(cfg.time_end as string) ?? '18:00'}
                  onChange={(e) => onUpdate({ config: { ...cfg, time_end: e.target.value } })} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const).map((day) => {
                  const days: string[] = (cfg.time_days as string[]) ?? ['Mon','Tue','Wed','Thu','Fri'];
                  const active = days.includes(day);
                  return (
                    <button key={day} type="button"
                      onClick={() => onUpdate({ config: { ...cfg, time_days: active ? days.filter((d) => d !== day) : [...days, day] } })}
                      className={`px-3 py-1 rounded-lg text-[12px] font-semibold border transition-colors ${active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-200'}`}
                    >{day}</button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Request Type */}
          {hasBody && (
            <div>
              <label className="text-[13px] font-semibold text-gray-700 block mb-1.5">Request Type</label>
              <select className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none bg-white"
                value={requestFormat}
                onChange={(e) => onUpdate({ config: { ...cfg, request_format: e.target.value } })}>
                <option value="json">JSON</option>
                <option value="form">Form</option>
              </select>
            </div>
          )}

          {/* Body */}
          {hasBody && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-500" />
                    <span className="text-[14px] font-bold text-gray-800">Body</span>
                  </div>
                  {/* Mode toggle */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button type="button"
                      onClick={() => updateBodyMode('fields')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${bodyMode === 'fields' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      Field Builder
                    </button>
                    <button type="button"
                      onClick={() => updateBodyMode('raw')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${bodyMode === 'raw' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      Raw JSON
                    </button>
                  </div>
                </div>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  {bodyMode === 'raw' ? 'Write nested JSON with variable tokens like {first_name}, {%city%}' : requestFormat === 'form' ? 'Form fields sent as the request body' : 'JSON fields sent as the request body'}
                </p>
              </div>

              {bodyMode === 'raw' ? (
                <div className="p-4 space-y-2">
                  <textarea
                    rows={12}
                    value={rawPayload}
                    onChange={(e) => onUpdate({ config: { ...cfg, payload: e.target.value } })}
                    placeholder={`{\n  "first_name": "{first_name}",\n  "email": "{email}",\n  "phone": "{phone}",\n  "city": "{%city%}",\n  "extra": {\n    "First Name": "{first_name}",\n    "Grams": "{%grams%}",\n    "Pincode": "{%pincode%}",\n    "City": "{%city%}"\n  }\n}`}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[12px] font-mono outline-none focus:border-gray-400 resize-none bg-gray-50"
                  />
                  <p className="text-[11px] text-gray-400">
                    Supports: <code className="bg-gray-100 px-1 rounded">{'{first_name}'}</code> <code className="bg-gray-100 px-1 rounded">{'{email}'}</code> <code className="bg-gray-100 px-1 rounded">{'{phone}'}</code> <code className="bg-gray-100 px-1 rounded">{'{pipeline}'}</code> <code className="bg-gray-100 px-1 rounded">{'{assigned_staff}'}</code> <code className="bg-gray-100 px-1 rounded">{'{%city%}'}</code> <code className="bg-gray-100 px-1 rounded">{'{%grams%}'}</code> etc.
                  </p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {bodyFields.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input placeholder="Key" value={row.key}
                        onChange={(e) => updateRow(bodyFields, updateBodyFields, i, { key: e.target.value })}
                        className="w-[45%] border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-400" />
                      <input placeholder="Value" value={row.value}
                        onChange={(e) => updateRow(bodyFields, updateBodyFields, i, { value: e.target.value })}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-400" />
                      <button type="button" title="Insert variable"
                        onClick={() => { setCvOpen({ section: 'body', idx: i }); setCvTab(cvTabs[0]?.id ?? ''); }}
                        className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 shrink-0">
                        <Tag className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => removeRow(bodyFields, updateBodyFields, i)}
                        className="p-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {bodyFields.length === 0 && (
                    <p className="text-[12px] text-gray-400 text-center py-2">No fields — full lead object sent by default</p>
                  )}
                  <button type="button" onClick={() => addRow(bodyFields, updateBodyFields)}
                    className="mt-1 flex items-center gap-1 text-[13px] text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 w-full justify-center">
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Headers */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-gray-500" />
                <span className="text-[14px] font-bold text-gray-800">Headers</span>
              </div>
              <p className="text-[12px] text-gray-500 mt-0.5">Custom HTTP headers sent with the webhook request</p>
            </div>
            <div className="p-4 space-y-2">
              {headerFields.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input placeholder="Key" value={row.key}
                    onChange={(e) => updateRow(headerFields, updateHeaderFields, i, { key: e.target.value })}
                    className="w-[38%] border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-400" />
                  <input placeholder="Value" value={row.value}
                    onChange={(e) => updateRow(headerFields, updateHeaderFields, i, { value: e.target.value })}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-400" />
                  <button type="button" title="Insert variable"
                    onClick={() => { setCvOpen({ section: 'header', idx: i }); setCvTab(cvTabs[0]?.id ?? ''); }}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 shrink-0">
                    <Tag className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => removeRow(headerFields, updateHeaderFields, i)}
                    className="p-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {headerFields.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-2">No custom headers</p>
              )}
              <button type="button" onClick={() => addRow(headerFields, updateHeaderFields)}
                className="mt-1 flex items-center gap-1 text-[13px] text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 w-full justify-center">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
          </div>

          {/* Save response */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-semibold text-gray-800 block">Save response to field</span>
                <span className="text-[12px] text-gray-500">Store the API response value in a custom field</span>
              </div>
              <Switch checked={!!(cfg.save_response)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, save_response: v } })} />
            </div>
            {!!(cfg.save_response) && (
              <FieldRow label="Custom Field">
                <select className={selectCls} value={(cfg.save_response_field as string) ?? ''}
                  onChange={sel('save_response_field')}>
                  <option value="">— Select field —</option>
                  {customFields.map((cf) => <option key={cf.id} value={cf.slug}>{cf.name}</option>)}
                </select>
              </FieldRow>
            )}
          </div>

          {/* ── Custom Values Modal ─────────────────────────────────── */}
          {cvOpen && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center" onClick={() => setCvOpen(null)}>
              <div className="absolute inset-0 bg-black/40" />
              <div className="relative bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h3 className="text-[18px] font-bold text-gray-900">Custom Values</h3>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setCvTab(cvTabs[0]?.id || '')}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title="Reset tab">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setCvOpen(null)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/* Tabs */}
                <div className="flex gap-0 border-b border-gray-100 px-4">
                  {cvTabs.map((tab) => (
                    <button key={tab.id} type="button"
                      onClick={() => setCvTab(tab.id)}
                      className={`px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors -mb-px ${(cvTab === tab.id || (!cvTab && cvTabs[0]?.id === tab.id)) ? 'border-gray-800 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                {/* Field list */}
                <div className="overflow-y-auto flex-1 px-2 py-2">
                  {((cvTabs.find((t) => t.id === cvTab) ?? cvTabs[0])?.fields ?? []).length === 0 ? (
                    <p className="text-[13px] text-gray-400 text-center py-8">No fields found</p>
                  ) : (
                    ((cvTabs.find((t) => t.id === cvTab) ?? cvTabs[0])?.fields ?? []).map((field) => (
                      <div key={field.variable}
                        className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-gray-50 group">
                        <div>
                          <p className="text-[14px] font-semibold text-gray-900">{field.name}</p>
                          <p className="text-[12px] text-gray-400 font-mono mt-0.5">{field.variable}</p>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button"
                            onClick={() => { copyToClipboard(field.variable); toast.success('Copied!'); }}
                            className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400" title="Copy">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button type="button"
                            onClick={() => insertVariable(field.name, field.variable)}
                            className="w-6 h-6 rounded-full bg-gray-800 hover:bg-black text-white flex items-center justify-center" title="Insert">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>);
      })()}

      {/* API Request */}
      {node.actionType === 'api_call' && (<>
        <FieldRow label="URL" required>
          <input type="url" className={inputCls} value={(cfg.url as string) ?? ''} onChange={sel('url')} placeholder="https://api.example.com/endpoint" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="Method">
            <select className={selectCls} value={(cfg.method as string) ?? 'GET'} onChange={sel('method')}>
              <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
            </select>
          </FieldRow>
          <FieldRow label="Content Type">
            <select className={selectCls} value={(cfg.contentType as string) ?? 'application/json'} onChange={sel('contentType')}>
              <option value="application/json">JSON</option>
              <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
              <option value="multipart/form-data">Multipart Form</option>
            </select>
          </FieldRow>
        </div>
        <FieldRow label="Headers (JSON)">
          <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none font-mono" rows={3} placeholder='{"Authorization": "Bearer {{api_key}}"}' value={(cfg.headers as string) ?? ''} onChange={sel('headers')} />
        </FieldRow>
        <FieldRow label="Body (JSON)">
          <div>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none font-mono" rows={4} placeholder={'{"name": "{first_name}", "email": "{email}"}'} value={(cfg.body as string) ?? ''} onChange={sel('body')} />
            <VarHints onInsert={(v) => onUpdate({ config: { ...cfg, body: ((cfg.body as string) ?? '') + v } })} />
          </div>
        </FieldRow>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Save response to contact</span>
          <Switch checked={!!(cfg.saveResponse)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, saveResponse: v } })} />
        </div>
      </>)}

      {node.actionType === 'pincode_routing' && (() => {
        const selectedSlug = (cfg.pincode_field as string) ?? '';
        const selectedField = customFields.find((cf) => cf.slug === selectedSlug);
        const noFields = customFields.length === 0;
        const sets = routingSets ?? [];
        const selectedSetId = (cfg.set_id as string) ?? '';
        const selectedSet = sets.find((s) => s.id === selectedSetId);
        return (<>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3">
            <p className="text-xs text-green-800 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Looks up the lead field value in your routing set and routes the lead to the mapped pipeline. Upload your routing data in <strong>Automation → Uploads</strong>.
            </p>
          </div>

          {sets.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800 font-semibold">No routing sets found</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Go to{' '}
                <a href="/automation/pincode-routing" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-amber-900">Automation → Uploads</a>
                {' '}and create a routing set with your mapping data.
              </p>
            </div>
          ) : (
            <FieldRow label="Routing Set">
              <select
                className={selectCls}
                value={selectedSetId}
                onChange={(e) => onUpdate({ config: { ...cfg, set_id: e.target.value } })}
              >
                <option value="">— Select a routing set —</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.match_field}, {s.match_type})</option>
                ))}
              </select>
              {!selectedSetId && (
                <p className="text-[11px] text-red-500 font-medium mt-1">⚠ You must select a routing set — the node will be skipped until one is chosen.</p>
              )}
              {selectedSet && (
                <p className="text-[11px] text-blue-600 mt-1">
                  Matches lead's <strong>{selectedSet.match_field}</strong> field using <strong>{selectedSet.match_type}</strong> lookup.
                </p>
              )}
            </FieldRow>
          )}

          {noFields ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800 font-semibold">No custom fields found</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Go to{' '}
                <a href="/settings/fields" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-amber-900">Settings → Fields</a>
                {' '}and create a field (e.g. "Pincode") to hold the value from your form.
              </p>
            </div>
          ) : (
            <FieldRow label="Lead Field">
              <select
                className={selectCls}
                value={selectedSlug}
                onChange={sel('pincode_field')}
              >
                <option value="">— Select a custom field —</option>
                {customFields.map((cf) => (
                  <option key={cf.id} value={cf.slug}>{cf.name}</option>
                ))}
              </select>
              {!selectedSlug && (
                <p className="text-[11px] text-red-500 font-medium mt-1">⚠ You must select a field — the node will be skipped until one is chosen.</p>
              )}
              {selectedField && (
                <p className="text-[11px] text-blue-600 mt-1">
                  Make sure <strong>{selectedField.name}</strong> is mapped in <strong>Meta Forms → Map Fields</strong> so incoming leads carry this value.
                </p>
              )}
            </FieldRow>
          )}

          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-sm font-semibold block">Auto-tag with district name</span>
              <span className="text-xs text-muted-foreground">Adds e.g. "Coimbatore" as a tag on the lead after routing</span>
            </div>
            <Switch checked={!!(cfg.auto_tag)} onCheckedChange={(v) => onUpdate({ config: { ...cfg, auto_tag: v } })} />
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-sm font-semibold block">If value doesn't match</span>
              <span className="text-xs text-muted-foreground">Move lead to a fallback pipeline when the value is not found in your routing set</span>
            </div>
            <Switch
              checked={!!(cfg.fallback_enabled)}
              onCheckedChange={(v) => onUpdate({ config: { ...cfg, fallback_enabled: v, fallback_pipeline_id: v ? cfg.fallback_pipeline_id : undefined } })}
            />
          </div>

          {!!(cfg.fallback_enabled) && (
            <FieldRow label="Fallback Pipeline">
              <select
                className={selectCls}
                value={(cfg.fallback_pipeline_id as string) ?? ''}
                onChange={(e) => onUpdate({ config: { ...cfg, fallback_pipeline_id: e.target.value } })}
              >
                <option value="">— Select a pipeline —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {!(cfg.fallback_pipeline_id) && (
                <p className="text-[11px] text-amber-600 font-medium mt-1">⚠ Select a pipeline — unmatched leads will be skipped until one is chosen.</p>
              )}
            </FieldRow>
          )}
        </>);
      })()}

      {/* No-config actions */}
      {['exit_workflow', 'remove_workflow', 'remove_staff', 'remove_from_crm'].includes(node.actionType) && (
        <div className="py-6 text-center text-sm text-muted-foreground bg-muted/40 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-2">
            <NodeIconRenderer actionType={node.actionType} />
          </div>
          <p className="font-medium text-foreground">{ACTION_LIST.find((a) => a.id === node.actionType)?.label}</p>
          <p className="text-xs mt-1">No additional configuration required.</p>
        </div>
      )}

      {/* Fallback */}
      {!['add_to_crm','assign_ai','assign_staff','change_appointment','change_lead_quality','contact_group_access','contact_group','change_stage','add_tag','remove_tag','remove_contact','remove_from_crm','execute_automation','update_attributes','create_followup','create_note','event_start_time','internal_notify','send_email','send_sms','send_whatsapp','delay','if_else','tag_contact','post_instagram','facebook_post','webhook_call','api_call','exit_workflow','remove_workflow','remove_staff','pincode_routing'].includes(node.actionType) && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          <p className="text-xs">Select an action to configure it.</p>
        </div>
      )}
    </div>
  );
}

// ── Category icon/color map for trigger categories ──────────────────────────────
const TRIGGER_CAT_META: Record<string, { color: string; dot: string }> = {
  forms:    { color: 'text-purple-600 bg-purple-50',  dot: 'bg-purple-400' },
  crm:      { color: 'text-blue-600 bg-blue-50',      dot: 'bg-blue-400' },
  contact:  { color: 'text-emerald-600 bg-emerald-50',dot: 'bg-emerald-400' },
  calendar: { color: 'text-orange-600 bg-orange-50',  dot: 'bg-orange-400' },
  api:      { color: 'text-gray-600 bg-gray-100',     dot: 'bg-gray-400' },
  schedule: { color: 'text-sky-600 bg-sky-50',        dot: 'bg-sky-400' },
  inbox:    { color: 'text-indigo-600 bg-indigo-50',  dot: 'bg-indigo-400' },
  comments: { color: 'text-pink-600 bg-pink-50',      dot: 'bg-pink-400' },
  finance:  { color: 'text-green-600 bg-green-50',    dot: 'bg-green-400' },
  lms:      { color: 'text-violet-600 bg-violet-50',  dot: 'bg-violet-400' },
};

// ── Trigger Picker Modal ───────────────────────────────────────────────────────
function TriggerPickerModal({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (source: string, type: string, label: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState(TRIGGER_CATEGORIES[0].id);
  const [search, setSearch] = useState('');

  const allItems = TRIGGER_CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, catId: c.id, catLabel: c.label })));
  const searchResults = search ? allItems.filter((i) => i.label.toLowerCase().includes(search.toLowerCase())) : null;
  const currentCat = TRIGGER_CATEGORIES.find((c) => c.id === activeCategory) ?? TRIGGER_CATEGORIES[0];
  const displayItems = searchResults ?? currentCat.items;
  const meta = TRIGGER_CAT_META[activeCategory] ?? { color: 'text-primary bg-orange-50', dot: 'bg-primary' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '88vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-[18px] text-[#1c1410]">Choose a Trigger</h3>
            <p className="text-[12px] text-[#7a6b5c] mt-0.5">The event that starts this automation</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search triggers…"
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-[13px] outline-none focus:border-primary/50 w-48 bg-[var(--app-bg)] focus:bg-white transition-colors"
              />
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Body: 2-panel */}
        <div className="flex flex-1 min-h-0">

          {/* Left category sidebar */}
          {!search && (
            <div className="w-44 shrink-0 border-r border-gray-100 bg-[var(--app-bg)] py-2 overflow-y-auto">
              {TRIGGER_CATEGORIES.map((cat) => {
                const m = TRIGGER_CAT_META[cat.id] ?? { color: 'text-gray-600 bg-gray-50', dot: 'bg-gray-400' };
                const isActive = activeCategory === cat.id;
                return (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                    className={cn('w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium transition-all text-left',
                      isActive ? 'bg-white text-[#1c1410] font-bold border-r-2 border-primary' : 'text-[#7a6b5c] hover:bg-white/70'
                    )}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', m.dot)} />
                      <span className="truncate">{cat.label}</span>
                    </div>
                    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-1',
                      isActive ? 'bg-primary/10 text-primary' : 'bg-gray-200 text-gray-500'
                    )}>{cat.items.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Right card grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {search ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-4">
                {searchResults?.length} result{searchResults?.length !== 1 ? 's' : ''} for "{search}"
              </p>
            ) : (
              <div className="flex items-center gap-2 mb-5">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', meta.color)}>
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#1c1410]">{currentCat.label}</p>
                  <p className="text-[10px] text-[#7a6b5c]">{currentCat.items.length} trigger{currentCat.items.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            )}

            {displayItems.length === 0 ? (
              <div className="py-16 text-center">
                <Search className="w-8 h-8 mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-semibold text-[#7a6b5c]">No triggers found</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {displayItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.sourceId, item.id, item.label)}
                    className="group flex flex-col items-start gap-3 p-4 bg-white rounded-xl border border-black/[0.06] text-left hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center group-hover:bg-primary/10 transition-colors" style={{ background: 'rgba(234,88,12,0.07)' }}>
                      <item.Icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-[#1c1410] leading-snug">{item.label}</p>
                      {'catLabel' in item && search && (
                        <p className="text-[10px] text-[#7a6b5c] mt-0.5">{(item as any).catLabel}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Action category metadata ────────────────────────────────────────────────────
const CATEGORY_META: Record<ActionCategory, { Icon: ElementType; color: string }> = {
  'All':           { Icon: Zap,          color: 'text-primary bg-primary/10' },
  'Communication': { Icon: MessageSquare,color: 'text-blue-600 bg-blue-50' },
  'Conditions':    { Icon: GitBranch,    color: 'text-amber-600 bg-amber-50' },
  'Operation':     { Icon: Settings,     color: 'text-emerald-600 bg-emerald-50' },
  'Social':        { Icon: ThumbsUp,     color: 'text-pink-600 bg-pink-50' },
  'External Apps': { Icon: Code,         color: 'text-violet-600 bg-violet-50' },
  'Webhooks':      { Icon: Globe,        color: 'text-gray-600 bg-gray-100' },
};

// ── Action Picker Modal ────────────────────────────────────────────────────────
function ActionPickerModal({ onClose, onSelect }: { onClose: () => void; onSelect: (action: typeof ACTION_LIST[0]) => void }) {
  const [activeCategory, setActiveCategory] = useState<ActionCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = ACTION_LIST.filter((a) => {
    const matchCat = activeCategory === 'All' || a.category === activeCategory;
    const matchSearch = !searchQuery || a.label.toLowerCase().includes(searchQuery.toLowerCase()) || a.desc.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full shadow-2xl flex flex-col overflow-hidden" style={{ maxWidth: 860, height: '82vh' }}>

        {/* Header */}
        <div className="flex items-start justify-between px-7 pt-6 pb-4 shrink-0">
          <div>
            <h3 className="font-bold text-[20px] text-[#1c1410]">Add an Action</h3>
            <p className="text-[13px] text-[#7a6b5c] mt-0.5">Choose what happens next in your automation</p>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); if (e.target.value) setActiveCategory('All'); }}
                placeholder="Search actions..."
                className="pl-10 pr-4 py-2 border border-gray-200 rounded-full text-[13px] outline-none focus:border-primary/40 w-52 bg-gray-50 focus:bg-white transition-colors"
              />
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center transition-colors text-gray-400 hover:text-gray-700">
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Body: 2-panel */}
        <div className="flex flex-1 min-h-0">

          {/* Left sidebar */}
          <div className="w-52 shrink-0 py-1 overflow-y-auto">
            {ACTION_CATEGORIES.map((cat) => {
              const { Icon: CatIcon } = CATEGORY_META[cat];
              const count = cat === 'All' ? ACTION_LIST.length : ACTION_LIST.filter((a) => a.category === cat).length;
              const isActive = !searchQuery && activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setSearchQuery(''); }}
                  className={cn('w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium transition-all text-left relative',
                    isActive ? 'text-[#1c1410] font-bold' : 'text-[#7a6b5c] hover:text-[#1c1410]'
                  )}
                >
                  {isActive && <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
                  <CatIcon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary' : 'text-[#b09e8d]')} />
                  <span className="flex-1">{cat}</span>
                  <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 min-w-[22px] text-center',
                    isActive ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'
                  )}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="w-px bg-gray-100 shrink-0" />

          {/* Right: 2-col card list */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {searchQuery && (
              <p className="text-[12px] text-[#7a6b5c] mb-3 px-1">
                <span className="font-bold text-[#1c1410]">{filtered.length}</span> results for "{searchQuery}"
              </p>
            )}
            {filtered.length === 0 ? (
              <div className="py-20 text-center">
                <Search className="w-8 h-8 mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-semibold text-[#7a6b5c]">No actions found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {filtered.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => onSelect(action)}
                    className="group flex items-center gap-4 px-4 py-4 bg-white rounded-2xl border border-gray-100 text-left hover:border-primary/20 hover:shadow-sm transition-all"
                  >
                    <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', action.color)}>
                      <action.Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-[#1c1410] leading-snug">{action.label}</p>
                      <p className="text-[11px] text-[#7a6b5c] mt-0.5 leading-snug line-clamp-1">{action.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-200 group-hover:text-primary transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Workflow Settings Modal ────────────────────────────────────────────────────
function WorkflowSettingsModal({ workflow, onClose, onSave }: {
  workflow: WFRecord;
  onClose: () => void;
  onSave: (updates: Partial<WFRecord>) => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [allowReentry, setAllowReentry] = useState(workflow.allowReentry);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h3 className="font-bold text-xl text-gray-900 flex items-center gap-2"><Settings className="w-5 h-5" /> Workflow Settings</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="text-sm font-semibold text-gray-800 mb-1.5 block">Workflow Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter workflow name" />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-800 mb-1.5 block">Description</label>
            <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this workflow does..." />
          </div>
          <div className="flex items-start justify-between gap-4 p-4 bg-muted/40 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-foreground">Allow Re-entry</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow contacts to enter this workflow multiple times. If disabled, a contact can only run through this workflow once.</p>
            </div>
            <Switch checked={allowReentry} onCheckedChange={setAllowReentry} />
          </div>
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">Changes to workflow settings take effect for new contacts entering this workflow. Contacts already in the workflow will continue with the old settings.</p>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" onClick={() => { onSave({ name, description, allowReentry }); onClose(); }}>
            <Check className="w-4 h-4 mr-1" /> Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Node: renders a sub-list of nodes in a branch ──────────────────────
interface BranchNodeListProps {
  nodes: WFNode[];
  label: string;
  branchKey: 'yes' | 'no';
  parentNodeId: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onAddAction: (parentId: string, branch: 'yes' | 'no', afterIndex: number) => void;
  onDeleteBranchNode: (nodeId: string) => void;
  onSelectBranchNode: (nodeId: string, branch: 'yes' | 'no') => void;
}

function BranchNodeList({ nodes, label, branchKey, parentNodeId, selectedNodeId, onSelectNode, onAddAction, onDeleteBranchNode, onSelectBranchNode }: BranchNodeListProps) {
  const isYes = branchKey === 'yes';
  return (
    <div className="flex flex-col items-center min-w-[220px] px-3">
      {/* Branch label pill */}
      <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border',
        isYes ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'
      )}>
        <div className={cn('w-1.5 h-1.5 rounded-full', isYes ? 'bg-emerald-500' : 'bg-red-500')} />
        {label}
      </div>
      <div style={{ width: 0, height: 16, borderLeft: '2px dashed #d4c8bd' }} />
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center">
          <button
            onClick={() => onAddAction(parentNodeId, branchKey, -1)}
            className="group w-32 h-14 rounded-xl border-2 border-dashed border-[#c4b09e] bg-white/60 hover:border-primary hover:bg-orange-50/60 flex flex-col items-center justify-center transition-all gap-1"
            title={`Add step to ${label} branch`}
          >
            <Plus className="w-4 h-4 text-[#c4b09e] group-hover:text-primary transition-colors" />
            <span className="text-[10px] text-[#b09e8d] group-hover:text-primary transition-colors">Add step</span>
          </button>
          <div style={{ width: 0, height: 16, borderLeft: '2px dashed #d4c8bd' }} />
        </div>
      ) : (
        nodes.map((node, idx) => {
          const { bar: accentBar, icon: iconStyle, badge: badgeStyle } = nodeAccent(node.type, node.actionType);
          const isSelected = selectedNodeId === node.id;
          const isNestedCondition = node.type === 'condition' && node.actionType === 'if_else';
          return (
            <div key={node.id} className="flex flex-col items-center w-full">
              <button
                onClick={() => onSelectNode(node.id)}
                className={cn(
                  'relative flex items-center bg-white rounded-xl border text-left transition-all hover:shadow-md hover:-translate-y-0.5 overflow-hidden',
                  isNestedCondition ? 'w-[200px]' : 'w-full',
                  isSelected ? 'border-primary ring-2 ring-primary/15 shadow-md' : 'border-black/[0.07] shadow-sm'
                )}
              >
                <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentBar)} />
                <div className="flex items-center gap-2 px-2.5 py-2.5 ml-0.5 w-full">
                  <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', iconStyle)}>
                    <NodeIconRenderer actionType={node.actionType} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-[#1c1410] truncate leading-snug">{node.label}</p>
                    <span className={cn('text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded', badgeStyle)}>
                      {NODE_TYPE_LABEL[node.type] ?? 'Action'}
                    </span>
                  </div>
                </div>
              </button>

              {/* Nested if/else: render its Yes/No branches inline */}
              {isNestedCondition && (
                <div className="flex gap-6 mt-3 mb-1 items-start border border-amber-100 rounded-xl bg-amber-50/30 px-3 py-2">
                  <BranchNodeList
                    nodes={node.branches?.yes ?? []}
                    label={(node.config.yesLabel as string) || 'Yes'}
                    branchKey="yes"
                    parentNodeId={node.id}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                    onAddAction={onAddAction}
                    onDeleteBranchNode={onDeleteBranchNode}
                    onSelectBranchNode={onSelectBranchNode}
                  />
                  <div className="w-px bg-[#e8e0d8] self-stretch mt-6" />
                  <BranchNodeList
                    nodes={node.branches?.no ?? []}
                    label={(node.config.noLabel as string) || 'No'}
                    branchKey="no"
                    parentNodeId={node.id}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={onSelectNode}
                    onAddAction={onAddAction}
                    onDeleteBranchNode={onDeleteBranchNode}
                    onSelectBranchNode={onSelectBranchNode}
                  />
                </div>
              )}

              <div className="flex flex-col items-center">
                <div className="w-px h-5 bg-[#e2d9d0]" />
                <button
                  onClick={() => onAddAction(parentNodeId, branchKey, idx)}
                  className="group w-6 h-6 rounded-full bg-white border-2 border-dashed border-[#c4b09e] hover:border-primary hover:bg-orange-50 flex items-center justify-center transition-all shadow-sm"
                  title="Add step"
                >
                  <Plus className="w-3 h-3 text-[#c4b09e] group-hover:text-primary transition-colors" />
                </button>
                <div className="w-px h-5 bg-[#e2d9d0]" />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Node test status indicator ─────────────────────────────────────────────────
type NodeTestStatus = 'pending' | 'completed' | 'failed' | 'skipped';

function NodeStatusDot({ status }: { status: NodeTestStatus }) {
  if (status === 'pending') {
    return (
      <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border-2 border-amber-400 flex items-center justify-center shadow-md z-10">
        <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
      </div>
    );
  }
  if (status === 'completed') {
    return (
      <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center shadow-md z-10">
        <Check className="w-3 h-3 text-white" strokeWidth={3} />
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-red-500 border-2 border-white flex items-center justify-center shadow-md z-10">
        <X className="w-3 h-3 text-white" strokeWidth={3} />
      </div>
    );
  }
  if (status === 'skipped') {
    return (
      <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center shadow-md z-10">
        <span className="text-white text-[9px] font-bold">–</span>
      </div>
    );
  }
  return null;
}

// ── Canvas Node (handles rendering + if/else branching) ───────────────────────
interface CanvasNodeProps {
  node: WFNode;
  idx: number;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onInsertAfter: (idx: number) => void;
  onAddBranchAction: (parentId: string, branch: 'yes' | 'no', afterIndex: number) => void;
  onDeleteBranchNode: (nodeId: string) => void;
  onSelectBranchNode: (nodeId: string, branch: 'yes' | 'no') => void;
  testStatus?: NodeTestStatus;
}

function CanvasNode({ node, idx, selectedNodeId, onSelectNode, onInsertAfter, onAddBranchAction, onDeleteBranchNode, onSelectBranchNode, testStatus }: CanvasNodeProps) {
  const isCondition = node.type === 'condition' && node.actionType === 'if_else';
  const { bar: accentBar, icon: iconStyle, badge: badgeStyle } = nodeAccent(node.type, node.actionType);
  const isSelected = selectedNodeId === node.id;
  const triggerCat = node.type === 'trigger' && node.actionType
    ? TRIGGER_CATEGORIES.find((c) => c.items.some((i) => i.id === node.actionType))?.label ?? 'Trigger'
    : null;
  const typeLabel = triggerCat ?? (NODE_TYPE_LABEL[node.type] ?? 'Action');

  return (
    <div className="flex flex-col items-center">
      {/* Main node card */}
      <button
        onClick={() => onSelectNode(node.id)}
        className={cn(
          'group relative flex items-center bg-white rounded-xl text-left transition-all hover:shadow-md hover:-translate-y-0.5 overflow-visible min-w-[180px] max-w-[220px]',
          isSelected
            ? 'border-2 border-primary ring-2 ring-primary/15 shadow-md'
            : 'border border-black/[0.07] shadow-sm hover:border-primary/25'
        )}
      >
        {/* Colored left accent bar */}
        <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentBar)} />

        <div className="flex items-center gap-2.5 px-3 py-3 ml-0.5 w-full">
          {/* Icon */}
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconStyle)}>
            <NodeIconRenderer actionType={node.actionType} />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn('text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full', badgeStyle)}>
                {typeLabel}
              </span>
              <span className="text-[9px] text-[#b09e8d] font-semibold">#{idx + 1}</span>
            </div>
            <p className="text-[12px] font-bold text-[#1c1410] leading-snug truncate">
              {node.label || <span className="text-[#b09e8d] italic font-normal">Not set</span>}
            </p>
          </div>

        </div>
        {testStatus && <NodeStatusDot status={testStatus} />}
      </button>

      {isCondition ? (
        /* ── If/Else branching layout ── */
        <div className="flex flex-col items-center w-full">
          <div className="w-px h-6 bg-[#e2d9d0]" />
          {/* Horizontal branch spread */}
          <div className="flex items-start gap-6 relative">
            <div className="absolute top-0 left-[20%] right-[20%] h-px bg-[#e2d9d0]" />
            <BranchNodeList
              nodes={node.branches?.yes ?? []}
              label={(node.config.yesLabel as string) || 'Yes'}
              branchKey="yes"
              parentNodeId={node.id}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => onSelectBranchNode(id, 'yes')}
              onAddAction={onAddBranchAction}
              onDeleteBranchNode={onDeleteBranchNode}
              onSelectBranchNode={onSelectBranchNode}
            />
            <div className="w-px bg-[#e8e0d8] self-stretch mt-6" />
            <BranchNodeList
              nodes={node.branches?.no ?? []}
              label={(node.config.noLabel as string) || 'No'}
              branchKey="no"
              parentNodeId={node.id}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => onSelectBranchNode(id, 'no')}
              onAddAction={onAddBranchAction}
              onDeleteBranchNode={onDeleteBranchNode}
              onSelectBranchNode={onSelectBranchNode}
            />
          </div>
          {/* Merge point */}
          <div className="flex flex-col items-center mt-2">
            <div style={{ width: 0, height: 20, borderLeft: '2px dashed #d4c8bd' }} />
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f5f0eb] text-[#7a6b5c] text-[10px] font-bold border border-[#e8e0d8]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#c4b09e]" />
              Merge
            </div>
            <div style={{ width: 0, height: 20, borderLeft: '2px dashed #d4c8bd' }} />
            <button
              onClick={() => onInsertAfter(idx)}
              className="group/add w-8 h-8 rounded-full bg-white border-2 border-dashed border-[#c4b09e] hover:border-primary hover:bg-orange-50 flex items-center justify-center transition-all shadow-sm"
              title="Add step after merge"
            >
              <Plus className="w-3.5 h-3.5 text-[#c4b09e] group-hover/add:text-primary transition-colors" />
            </button>
            <div style={{ width: 0, height: 24, borderLeft: '2px dashed #d4c8bd' }} />
          </div>
        </div>
      ) : (
        /* ── Standard linear connector ── */
        <div className="flex flex-col items-center">
          <div style={{ width: 0, height: 28, borderLeft: '2px dashed #d4c8bd' }} />
          <button
            onClick={() => onInsertAfter(idx)}
            className="group/add w-8 h-8 rounded-full bg-white border-2 border-dashed border-[#c4b09e] hover:border-primary hover:bg-orange-50 flex items-center justify-center transition-all shadow-sm"
            title="Add step"
          >
            <Plus className="w-3.5 h-3.5 text-[#c4b09e] group-hover/add:text-primary transition-colors" />
          </button>
          <div style={{ width: 0, height: 28, borderLeft: '2px dashed #d4c8bd' }} />
        </div>
      )}
    </div>
  );
}

// ── Recursive tree helpers for nested if/else support ─────────────────────────
function findNodeById(nodes: WFNode[], nodeId: string): WFNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    if (n.branches) {
      const found = findNodeById(n.branches.yes, nodeId) ?? findNodeById(n.branches.no, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function updateNodeById(nodes: WFNode[], nodeId: string, updates: Partial<WFNode>): WFNode[] {
  return nodes.map((n) => {
    if (n.id === nodeId) return { ...n, ...updates };
    if (!n.branches) return n;
    return { ...n, branches: { yes: updateNodeById(n.branches.yes, nodeId, updates), no: updateNodeById(n.branches.no, nodeId, updates) } };
  });
}

function deleteNodeById(nodes: WFNode[], nodeId: string): WFNode[] {
  return nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => {
      if (!n.branches) return n;
      return { ...n, branches: { yes: deleteNodeById(n.branches.yes, nodeId), no: deleteNodeById(n.branches.no, nodeId) } };
    });
}

function insertIntoBranch(nodes: WFNode[], parentId: string, branch: 'yes' | 'no', afterIndex: number, newNode: WFNode): WFNode[] {
  return nodes.map((n) => {
    if (n.id === parentId) {
      const arr = [...(n.branches?.[branch] ?? [])];
      arr.splice(afterIndex < 0 ? 0 : afterIndex + 1, 0, newNode);
      return { ...n, branches: { yes: n.branches?.yes ?? [], no: n.branches?.no ?? [], [branch]: arr } };
    }
    if (!n.branches) return n;
    return { ...n, branches: { yes: insertIntoBranch(n.branches.yes, parentId, branch, afterIndex, newNode), no: insertIntoBranch(n.branches.no, parentId, branch, afterIndex, newNode) } };
  });
}

// ── Branch node state for panel ───────────────────────────────────────────────
interface BranchNodeContext {
  nodeId: string;
  branch: 'yes' | 'no';
}

// ── Node Config Modal ──────────────────────────────────────────────────────────
function NodeConfigModal({
  node, branchCtx, onClose, onUpdate, onDelete, onChangeTrigger, onChangeAction,
  pipelines, staff, forms, metaForms, eventTypes, bookingLinks, metaPages, webhookUrls, templates, workflows, routingSets, contactGroups, sheetConfigs,
  showAIPanel, setShowAIPanel,
  aiPrompt, setAIPrompt, aiTone, setAITone, aiFormat, setAIFormat, aiLength, setAILength,
  onAIGenerate, allowReentry, onToggleReentry, onRefreshPipelines, refreshingPipelines,
  workflowId, apiToken, onRegenerateToken,
}: {
  node: WFNode;
  branchCtx: BranchNodeContext | null;
  onClose: () => void;
  onUpdate: (u: Partial<WFNode>) => void;
  onDelete: () => void;
  onChangeTrigger: () => void;
  onChangeAction: () => void;
  pipelines: PipelineOpt[];
  staff: StaffOpt[];
  forms: FormOpt[];
  metaForms: FormOpt[];
  eventTypes: FormOpt[];
  bookingLinks: FormOpt[];
  metaPages: FormOpt[];
  webhookUrls: { webhookInbound: string; paymentReceived: string; courseEnrolled: string };
  templates: TemplateOpt[];
  workflows: { id: string; name: string; status: string }[];
  routingSets?: { id: string; name: string; match_field: string; match_type: string }[];
  contactGroups?: { id: string; name: string }[];
  sheetConfigs?: { id: string; spreadsheet_name: string; sheet_name: string }[];
  showAIPanel: boolean;
  setShowAIPanel: (v: boolean) => void;
  aiPrompt: string; setAIPrompt: (v: string) => void;
  aiTone: string; setAITone: (v: string) => void;
  aiFormat: string; setAIFormat: (v: string) => void;
  aiLength: string; setAILength: (v: string) => void;
  onAIGenerate: () => void;
  allowReentry: boolean;
  onToggleReentry: (val: boolean) => void;
  onRefreshPipelines?: () => void;
  refreshingPipelines?: boolean;
  workflowId?: string;
  apiToken?: string;
  onRegenerateToken?: () => void;
}) {
  const [tab, setTab] = useState<'settings' | 'ai'>('settings');
  const { icon: iconStyle, badge: badgeStyle, bar: accentBar } = nodeAccent(node.type, node.actionType);
  const triggerCatLabel = node.type === 'trigger' && node.actionType
    ? TRIGGER_CATEGORIES.find((c) => c.items.some((i) => i.id === node.actionType))?.label ?? 'Trigger'
    : null;
  const typeLabel = triggerCatLabel ?? (NODE_TYPE_LABEL[node.type] ?? 'Action');
  const isCommNode = ['send_email','send_sms','send_whatsapp','send_whatsapp_personal','internal_notify','create_note'].includes(node.actionType);
  const isTrigger = node.type === 'trigger';

  const handleSaveClose = () => {
    if (node.actionType === 'pincode_routing' && !(node.config.set_id as string)) {
      toast.error('Select a routing set for Field Routing before saving.');
      return;
    }
    if (node.actionType === 'pincode_routing' && !(node.config.pincode_field as string)) {
      toast.error('Select a lead field for Field Routing before saving.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-center gap-3 px-5 py-4 border-b border-black/[0.06] shrink-0 overflow-hidden">
          {/* Accent strip */}
          <div className={cn('absolute left-0 top-0 bottom-0 w-1', accentBar)} />

          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ml-1', iconStyle)}>
            <NodeIconRenderer actionType={node.actionType} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full', badgeStyle)}>{typeLabel}</span>
              {branchCtx && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                  branchCtx.branch === 'yes' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                )}>{branchCtx.branch.toUpperCase()} branch</span>
              )}
            </div>
            <p className="text-[14px] font-bold text-[#1c1410] truncate mt-0.5">{node.label || 'Configure Node'}</p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onDelete} className="w-7 h-7 rounded-lg hover:bg-red-50 text-[#c4b09e] hover:text-red-500 flex items-center justify-center transition-colors" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-gray-100 text-[#c4b09e] hover:text-[#1c1410] flex items-center justify-center transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tabs — only show AI tab for communication nodes */}
        {isCommNode && (
          <div className="flex border-b border-black/[0.06] px-5 shrink-0">
            {(['settings', 'ai'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('pb-2.5 pt-2 mr-5 text-[12px] font-semibold border-b-2 transition-colors capitalize',
                  tab === t ? 'border-primary text-primary' : 'border-transparent text-[#7a6b5c] hover:text-[#1c1410]'
                )}>
                {t === 'ai' ? '✦ AI Generate' : 'Settings'}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'ai' && isCommNode ? (
            /* AI Generate tab */
            <div className="space-y-3">
              <textarea
                className="w-full border border-purple-100 rounded-xl px-3 py-2.5 text-[13px] bg-purple-50/50 focus:border-purple-300 outline-none resize-none placeholder:text-purple-300"
                rows={3}
                placeholder="Describe what to generate… e.g. Follow-up email for sales leads"
                value={aiPrompt}
                onChange={(e) => setAIPrompt(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Tone', value: aiTone, set: setAITone, opts: ['Professional','Friendly','Formal','Casual'] },
                  { label: 'Format', value: aiFormat, set: setAIFormat, opts: ['Email','SMS','WhatsApp'] },
                  { label: 'Length', value: aiLength, set: setAILength, opts: ['Short','Medium','Long'] },
                ].map(({ label, value, set, opts }) => (
                  <div key={label}>
                    <p className="text-[9px] font-bold text-[#7a6b5c] uppercase tracking-wide mb-1">{label}</p>
                    <select className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white" value={value} onChange={(e) => set(e.target.value)}>
                      {opts.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-[11px] text-[#7a6b5c] cursor-pointer">
                  <input type="checkbox" className="rounded accent-purple-500" defaultChecked /> Personalize with name
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-[#7a6b5c] cursor-pointer">
                  <input type="checkbox" className="rounded accent-purple-500" defaultChecked /> Include CTA
                </label>
              </div>
              <button
                onClick={() => { onAIGenerate(); setTab('settings'); }}
                disabled={!aiPrompt.trim()}
                className="w-full py-2.5 rounded-xl text-[12px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #9333ea)', boxShadow: '0 2px 8px rgba(124,58,237,0.3)' }}
              >
                ✦ Generate Content
              </button>
            </div>
          ) : (
            /* Settings tab */
            <>
              {node.type === 'trigger'
                ? <TriggerConfigPanel node={node} onUpdate={onUpdate} onChangeTrigger={onChangeTrigger} pipelines={pipelines} staff={staff} forms={forms} metaForms={metaForms} eventTypes={eventTypes} bookingLinks={bookingLinks} metaPages={metaPages} webhookUrls={webhookUrls} contactGroups={contactGroups} sheetConfigs={sheetConfigs} allowReentry={allowReentry} onToggleReentry={onToggleReentry} workflowId={workflowId} apiToken={apiToken} onRegenerateToken={onRegenerateToken} />
                : node.type === 'condition'
                ? <ConditionConfigPanel node={node} onUpdate={onUpdate} pipelines={pipelines} staff={staff} />
                : <ActionConfigPanel node={node} onUpdate={onUpdate} pipelines={pipelines} staff={staff} templates={templates} workflows={workflows} routingSets={routingSets} contactGroups={contactGroups} onRefreshPipelines={onRefreshPipelines} refreshingPipelines={refreshingPipelines} />
              }
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-black/[0.06] bg-[var(--app-bg)] shrink-0">
          <button
            onClick={handleSaveClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))', boxShadow: '0 2px 8px rgba(234,88,12,0.25)' }}
          >
            <Check className="w-3.5 h-3.5 inline mr-1" /> Save & Close
          </button>
          {isTrigger && (
            <button
              onClick={() => { onChangeTrigger(); onClose(); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold border border-primary/30 text-primary hover:bg-primary/5 transition-all"
            >
              Change Trigger
            </button>
          )}
          {!isTrigger && node.type !== 'condition' && (
            <button
              onClick={onChangeAction}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold border border-primary/30 text-primary hover:bg-primary/5 transition-all"
            >
              Change Action
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Test Workflow Modal ────────────────────────────────────────────────────────
function TestWorkflowModal({ workflowId, onClose, onTestStart, onTestDone }: {
  workflowId: string;
  onClose: () => void;
  onTestStart: () => void;
  onTestDone: (results: Record<string, { status: string; message: string }>) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string; phone?: string; email?: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await api.get<any[]>(`/api/leads?search=${encodeURIComponent(search)}&limit=8`);
        setResults(rows ?? []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const runTest = async () => {
    const leadId = selected?.id;
    if (!leadId) { toast.error('Select a contact from your CRM to test'); return; }
    setRunning(true);
    setDone(null);
    onTestStart();
    try {
      const res = await api.post<any>(`/api/workflows/${workflowId}/test`, {
        lead_id: leadId,
      });
      onTestDone(res.nodeResults ?? {});
      setDone({ success: true, message: res.message ?? 'Test completed successfully' });
      toast.success(res.message ?? 'Test completed');
    } catch (err: any) {
      onTestDone((err as any)?.nodeResults ?? {});
      setDone({ success: false, message: err?.message ?? 'Test failed' });
      toast.error(err?.message ?? 'Test failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.06]">
          <h3 className="text-[17px] font-bold text-[#1c1410]">Test Workflow</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* Contact search */}
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Select Contact</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-[13px] outline-none focus:border-primary/40 placeholder:text-gray-400 bg-white"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 animate-spin" />}
            </div>
            {results.length > 0 && !selected && (
              <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden shadow-md">
                {results.map((r) => {
                  const parts = (r.name ?? '').split(' ');
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setSelected({ id: r.id, name: r.name, phone: r.phone, email: r.email }); setSearch(r.name); setResults([]); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#faf0e8] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
                        {(parts[0]?.[0] ?? '').toUpperCase()}{(parts[1]?.[0] ?? '').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[#1c1410] truncate">{r.name}</p>
                        <p className="text-[11px] text-[#7a6b5c] truncate">{[r.phone, r.email].filter(Boolean).join(' · ')}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selected && (
              <div className="mt-2 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-primary/30 bg-primary/5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
                  {selected.name.split(' ').map((p) => p[0]).slice(0,2).join('').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#1c1410]">{selected.name}</p>
                  {selected.phone && <p className="text-[11px] text-[#7a6b5c]">{selected.phone}</p>}
                </div>
                <button onClick={() => { setSelected(null); setSearch(''); }} className="text-gray-400 hover:text-red-500 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Result */}
          {done && (
            <div className={cn('flex items-start gap-2.5 px-4 py-3 rounded-xl text-[12px] font-medium', done.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')}>
              <div className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-white text-[10px] font-bold', done.success ? 'bg-emerald-500' : 'bg-red-500')}>
                {done.success ? '✓' : '✕'}
              </div>
              {done.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.06]">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-[#1c1410] hover:bg-gray-50 transition-colors">Close</button>
          <button
            onClick={runTest}
            disabled={running || !selected}
            className="px-6 py-2 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,var(--brand-dark) 0%,var(--brand) 55%,var(--brand-light) 100%)' }}
          >
            {running ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : <><Play className="w-3.5 h-3.5" /> Run Test</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Editor ────────────────────────────────────────────────────────────────
export default function WorkflowEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  const passedWorkflow = (location.state as { workflow?: WFRecord })?.workflow;
  const [workflow, setWorkflow] = useState<WFRecord>(
    passedWorkflow ?? {
      id: id ?? 'new',
      name: 'Untitled Automation',
      description: '',
      allowReentry: false,
      totalContacts: 0,
      completed: 0,
      completedNodes: 0,
      lastUpdated: 'just now',
      status: 'inactive',
      nodes: [{ id: 'n1', type: 'trigger', actionType: '', label: 'Select Trigger', config: {} }],
    }
  );

  // Load from API when navigated directly (no location.state) — covers hard refresh
  useEffect(() => {
    if (passedWorkflow || !id || id === 'new') return;
    setLoadingWF(true);
    api.get<any>(`/api/workflows/${id}`).then((r) => {
      justLoadedFromApi.current = true;
      baseUpdatedAtRef.current = r.updated_at ?? null;
      setWorkflow({
        id: r.id, name: r.name, description: r.description ?? '',
        allowReentry: r.allow_reentry ?? false,
        totalContacts: r.total_contacts ?? 0, completed: r.completed ?? 0,
        completedNodes: (r.nodes ?? []).filter((n: any) => n.type !== 'trigger').length,
        lastUpdated: new Date(r.updated_at).toLocaleDateString(),
        status: r.status as 'active' | 'inactive',
        nodes: Array.isArray(r.nodes) ? r.nodes : (typeof r.nodes === 'string' ? JSON.parse(r.nodes) : []),
        apiToken: r.api_token ?? '',
      });
      // Show the real last-saved time, not "Not saved yet", for an already-saved workflow.
      const ts = r?.updated_at ? new Date(r.updated_at).getTime() : NaN;
      if (!Number.isNaN(ts)) setSavedAt(ts);
    }).catch(() => toast.error('Failed to load workflow'))
      .finally(() => setLoadingWF(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When opened with a workflow passed from the list (no full load), still fetch
  // its current version so the save guard is active (multi-tab safety).
  useEffect(() => {
    if (!passedWorkflow || !id || id === 'new') return;
    api.get<any>(`/api/workflows/${id}`).then((r) => { baseUpdatedAtRef.current = r?.updated_at ?? null; }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save whenever nodes or name/status change
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (justLoadedFromApi.current) { justLoadedFromApi.current = false; return; }
    if (!workflow.id || workflow.id === 'new') return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // Only autosave from the visible tab so a background tab can't fight the one
    // you're editing (prevents the 409 ping-pong when the same workflow is open twice).
    autoSaveTimer.current = setTimeout(() => {
      if (document.visibilityState === 'visible') persist({ silent: true });
    }, 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [workflow.nodes, workflow.name, workflow.status, workflow.description, workflow.allowReentry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ref in sync so beforeunload always has latest workflow
  useEffect(() => { workflowRef.current = workflow; }, [workflow]);

  // On refocus: if this tab has unsaved edits, flush them; if it's clean, reload the
  // latest so a previously-backgrounded tab never edits on top of a stale version.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (dirtyRef.current) persist({ silent: true });
      else reloadFromServer();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On unmount: clear timers AND flush a final save if there are unsaved changes
  // (covers in-app navigation away within the autosave debounce window).
  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const wf = workflowRef.current;
    if (wf.id && wf.id !== 'new' && dirtyRef.current) {
      const token = getAccessToken();
      fetch(`${BASE}/api/workflows/${wf.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: wf.name, description: wf.description, nodes: wf.nodes, status: wf.status, allow_reentry: wf.allowReentry, base_updated_at: baseUpdatedAtRef.current }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  // Re-render every 20s so the "Saved X ago" label stays current.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  // Flush save on page unload (covers F5 within the debounce window)
  useEffect(() => {
    const flush = () => {
      const wf = workflowRef.current;
      if (!wf.id || wf.id === 'new') return;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const token = getAccessToken();
      fetch(`${BASE}/api/workflows/${wf.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: wf.name, description: wf.description, nodes: wf.nodes, status: wf.status, allow_reentry: wf.allowReentry, base_updated_at: baseUpdatedAtRef.current }),
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch pipelines, staff, forms, templates, workflows for dynamic dropdowns
  const [editorPipelines, setEditorPipelines] = useState<PipelineOpt[]>([]);
  const [editorStaff, setEditorStaff] = useState<StaffOpt[]>([]);
  const [editorForms, setEditorForms] = useState<FormOpt[]>([]);
  const [editorMetaForms, setEditorMetaForms] = useState<FormOpt[]>([]);
  const [editorTemplates, setEditorTemplates] = useState<TemplateOpt[]>([]);
  const [editorWorkflows, setEditorWorkflows] = useState<{ id: string; name: string; status: string }[]>([]);
  const [editorEventTypes, setEditorEventTypes] = useState<FormOpt[]>([]);
  const [editorBookingLinks, setEditorBookingLinks] = useState<FormOpt[]>([]);
  const [editorMetaPages, setEditorMetaPages] = useState<FormOpt[]>([]);
  const [editorWebhookUrls, setEditorWebhookUrls] = useState({ webhookInbound: '', paymentReceived: '', courseEnrolled: '' });
  const [editorRoutingSets, setEditorRoutingSets] = useState<{ id: string; name: string; match_field: string; match_type: string }[]>([]);
  const [editorContactGroups, setEditorContactGroups] = useState<{ id: string; name: string }[]>([]);
  const [editorSheetConfigs, setEditorSheetConfigs] = useState<{ id: string; spreadsheet_name: string; sheet_name: string }[]>([]);
  const [refreshingPipelines, setRefreshingPipelines] = useState(false);

  const refreshPipelines = () => {
    setRefreshingPipelines(true);
    api.get<any[]>('/api/pipelines').then((rows) => {
      setEditorPipelines((rows ?? []).map((p) => ({
        id: p.id, name: p.name,
        stages: (p.stages ?? []).map((s: any) => ({ id: s.id, name: s.name })),
      })));
    }).catch(() => {}).finally(() => setRefreshingPipelines(false));
  };

  useEffect(() => {
    api.get<any[]>('/api/calendar/event-types').then((rows) => {
      setEditorEventTypes((rows ?? []).map((et) => ({ id: et.id, name: et.name })));
    }).catch(() => {});
    refreshPipelines();
    api.get<any[]>('/api/settings/staff').then((rows) => {
      setEditorStaff((rows ?? []).map((s) => ({ id: s.id, name: s.name })));
    }).catch(() => {});
    api.get<any[]>('/api/forms').then((rows) => {
      setEditorForms((rows ?? []).map((f) => ({ id: f.id, name: f.name })));
    }).catch(() => {});
    api.get<any[]>('/api/integrations/meta/connected-forms').then((rows) => {
      const active = (rows ?? []).filter((f) => f.is_active);
      setEditorMetaForms(active.map((f) => ({ id: f.form_id, name: f.form_name })));
    }).catch(() => {});
    api.get<any[]>('/api/templates').then((rows) => {
      setEditorTemplates((rows ?? []).map((t) => ({ id: t.id, name: t.name, body: t.body })));
    }).catch(() => {});
    api.get<any[]>('/api/workflows').then((rows) => {
      setEditorWorkflows((rows ?? []).filter((w) => w.id !== workflow.id).map((w) => ({ id: w.id, name: w.name, status: w.status })));
    }).catch(() => {});
    api.get<any[]>('/api/calendar/booking-links').then((rows) => {
      setEditorBookingLinks((rows ?? []).map((bl) => ({ id: bl.id, name: bl.name })));
    }).catch(() => {});
    api.get<any>('/api/integrations/meta/status').then((data) => {
      setEditorMetaPages((data?.connectedPages ?? []).map((p: any) => ({ id: p.id, name: p.name })));
    }).catch(() => {});
    api.get<any>('/api/settings/webhook-url').then((data) => {
      if (data) setEditorWebhookUrls({ webhookInbound: data.webhookInbound ?? '', paymentReceived: data.paymentReceived ?? '', courseEnrolled: data.courseEnrolled ?? '' });
    }).catch(() => {});
    api.get<any[]>('/api/field-routing/sets').then((rows) => {
      setEditorRoutingSets((rows ?? []).map((r) => ({ id: r.id, name: r.name, match_field: r.match_field, match_type: r.match_type })));
    }).catch(() => {});
    api.get<any[]>('/api/contact-groups').then((rows) => {
      setEditorContactGroups((rows ?? []).map((g) => ({ id: g.id, name: g.name })));
    }).catch(() => {});
    api.get<{ configs: any[] }>('/api/integrations/sheets/status').then((data) => {
      setEditorSheetConfigs((data.configs ?? []).map((c: any) => ({
        id: c.id, spreadsheet_name: c.spreadsheet_name ?? c.spreadsheet_id, sheet_name: c.sheet_name,
      })));
    }).catch(() => {});
    api.get<any[]>('/api/fields/custom').then((rows) => {
      useCrmStore.getState().reorderCustomFields((rows ?? []).map((cf: any) => ({
        id: cf.id, name: cf.name, slug: cf.slug, type: cf.type,
        required: cf.required ?? false, visible: cf.visible ?? true,
        options: cf.options ?? undefined, orderIndex: cf.order_index ?? 0,
      })));
    }).catch(() => {});
    // Value tokens (Fields → Values) — the editor runs outside AppLayout, so load
    // them here too; otherwise the Custom Values "Values" tab is empty on a direct load.
    api.get<any[]>('/api/fields/values').then((rows) => {
      useCrmStore.setState({
        valueTokens: (rows ?? []).map((v: any) => ({ id: v.id, name: v.name, replace_with: v.replace_with })),
      });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(workflow.nodes[0]?.id ?? null);
  const [selectedBranchCtx, setSelectedBranchCtx] = useState<BranchNodeContext | null>(null);
  const [showNoTriggerPopup, setShowNoTriggerPopup] = useState(false);
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [showDeleteWorkflowConfirm, setShowDeleteWorkflowConfirm] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testNodeResults, setTestNodeResults] = useState<Record<string, { status: string; message: string }>>({});
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | null>(null);
  const [insertBranchCtx, setInsertBranchCtx] = useState<{ parentId: string; branch: 'yes' | 'no'; afterIndex: number } | null>(null);
  const [changeActionMode, setChangeActionMode] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const dirtyRef = useRef(false);
  // Mirror dirty state into a ref so the unmount cleanup can read the latest value.
  useEffect(() => { dirtyRef.current = isDirty; }, [isDirty]);
  const isDirtyFirstRender = useRef(true);
  const [loadingWF, setLoadingWF] = useState(!passedWorkflow && !!id && id !== 'new');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const justLoadedFromApi = useRef(false);
  const workflowRef = useRef(workflow);
  // The updated_at the editor last loaded/saved — sent on every save so the server
  // can reject a stale overwrite (multi-tab safety).
  const baseUpdatedAtRef = useRef<string | null>(passedWorkflow ? null : null);
  const savingRef = useRef(false);      // a PATCH is currently in flight
  const saveAgainRef = useRef(false);   // edits arrived during the in-flight save → save once more
  const suppressDirtyRef = useRef(false); // suppress the dirty flag for a server-driven reload

  // Apply a server workflow object to local state (shared by load / reload).
  const applyServerWorkflow = (r: any) => {
    justLoadedFromApi.current = true;
    suppressDirtyRef.current = true; // the setWorkflow below must not mark the tab dirty
    baseUpdatedAtRef.current = r?.updated_at ?? null;
    setWorkflow({
      id: r.id, name: r.name, description: r.description ?? '',
      allowReentry: r.allow_reentry ?? false,
      totalContacts: r.total_contacts ?? 0, completed: r.completed ?? 0,
      completedNodes: (r.nodes ?? []).filter((n: any) => n.type !== 'trigger').length,
      lastUpdated: new Date(r.updated_at).toLocaleDateString(),
      status: r.status as 'active' | 'inactive',
      nodes: Array.isArray(r.nodes) ? r.nodes : (typeof r.nodes === 'string' ? JSON.parse(r.nodes) : []),
      apiToken: r.api_token ?? '',
    });
    setIsDirty(false);
    // Seed the "last saved" time from the server so a loaded workflow shows
    // "Saved <time>" instead of a misleading "Not saved yet".
    const ts = r?.updated_at ? new Date(r.updated_at).getTime() : NaN;
    if (!Number.isNaN(ts)) setSavedAt(ts);
  };

  // Reload from server (only when there are no local edits to lose).
  const reloadFromServer = async () => {
    const wf = workflowRef.current;
    if (!wf.id || wf.id === 'new') return;
    try {
      const r = await api.get<any>(`/api/workflows/${wf.id}`);
      applyServerWorkflow(r);
      setSaveStatus('saved');
      setSavedAt(Date.now());
    } catch { /* leave as-is */ }
  };

  // Serialized save. Only one PATCH in flight at a time; edits during a save queue
  // exactly one follow-up. Interactive saves are last-write-wins (NO version guard)
  // so they can never 409/loop. Stale-tab protection lives elsewhere: only the
  // visible tab autosaves, a clean tab reloads when refocused, and the close-flush
  // is still version-guarded so a stale closing tab can't clobber.
  const persist = async (_opts?: { silent?: boolean }): Promise<boolean> => {
    const wf = workflowRef.current;
    if (!wf.id || wf.id === 'new') return false;

    if (savingRef.current) { saveAgainRef.current = true; return false; }
    savingRef.current = true;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    setSaveStatus('saving');

    let ok = false;
    try {
      const cur = workflowRef.current; // always send the freshest snapshot
      const saved = await api.patch<any>(`/api/workflows/${cur.id}`, {
        name: cur.name,
        description: cur.description,
        nodes: cur.nodes,
        status: cur.status,
        allow_reentry: cur.allowReentry,
      });
      baseUpdatedAtRef.current = saved?.updated_at ?? baseUpdatedAtRef.current;
      setSaveStatus('saved');
      setSavedAt(Date.now());
      setIsDirty(false);
      ok = true;
    } catch {
      setSaveStatus('error');
      // Transient failure / token refresh — retry shortly.
      retryTimer.current = setTimeout(() => { persist({ silent: true }); }, 5000);
    } finally {
      savingRef.current = false;
    }

    // Edits arrived during this save → save once more with the latest snapshot.
    if (saveAgainRef.current) {
      saveAgainRef.current = false;
      return persist({ silent: true });
    }
    return ok;
  };

  const [zoom, setZoom] = useState(100);
  const [panelWidth, setPanelWidth] = useState(340);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [panelTab, setPanelTab] = useState<'settings' | 'history' | 'preview'>('settings');
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('');
  const [aiTone, setAITone] = useState('Professional');
  const [aiFormat, setAIFormat] = useState('Email');
  const [aiLength, setAILength] = useState('Medium');
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenuDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Refresh pipelines every time node config panel opens — catches pipelines created after editor loaded
  useEffect(() => {
    if (showNodeModal) refreshPipelines();
  }, [showNodeModal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh pipelines when an add_to_crm node is selected in the sidebar panel
  useEffect(() => {
    if (selectedNode?.actionType === 'add_to_crm' && !showNodeModal) refreshPipelines();
  }, [selectedNodeId, selectedBranchCtx?.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track unsaved changes
  useEffect(() => {
    if (isDirtyFirstRender.current) { isDirtyFirstRender.current = false; return; }
    // A server-driven reload changed the workflow — that's not a user edit.
    if (suppressDirtyRef.current) { suppressDirtyRef.current = false; return; }
    setIsDirty(true);
  }, [workflow.nodes, workflow.name, workflow.description, workflow.status, workflow.allowReentry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(600, Math.max(280, dragStartWidth.current + delta));
      setPanelWidth(next);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Determine which node is selected (main canvas or any nested branch)
  const selectedNode = selectedBranchCtx
    ? findNodeById(workflow.nodes, selectedBranchCtx.nodeId)
    : workflow.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const validateNodes = (nodes: WFNode[]): string | null => {
    for (const node of nodes) {
      if (node.type === 'trigger' && !node.actionType) return 'Trigger type is not set.';
      if (node.type === 'action') {
        if (node.actionType === 'assign_staff') {
          const mode = (node.config.assign_mode as string) ?? 'specific';
          const hasSpecific = ((node.config.staff_ids as string[] | undefined)?.length ?? 0) > 0;
          const hasByPipeline = ((node.config.pipeline_staff_mapping as any[] | undefined) ?? []).some((m: any) => (m.staff_ids?.length ?? 0) > 0 || m.staff_id);
          const hasRoundRobin = ((node.config.round_robin_pairs as any[] | undefined) ?? []).some((p: any) => p.staff_id);
          if (mode === 'specific' && !hasSpecific) return `"Assign To Staff" is missing a staff member.`;
          if (mode === 'by_pipeline' && !hasByPipeline) return `"Assign To Staff" has no pipeline rules with staff assigned.`;
          if (mode === 'round_robin' && !hasRoundRobin) return `"Assign To Staff" round-robin has no pairs with staff assigned.`;
        }
        if (node.actionType === 'change_stage' && !node.config.stage_id) return `"Change Pipeline Stage" is missing a stage.`;
        if (node.actionType === 'send_email' && !node.config.subject) return `"Send Email" is missing a subject.`;
        if (node.actionType === 'send_whatsapp' && !node.config.template) return `"WhatsApp Message" is missing a template.`;
        if (node.actionType === 'send_whatsapp_personal' && !node.config.message && !node.config.templateId) return `"WhatsApp Personal" is missing a message or template.`;
        if (node.actionType === 'webhook_call' && !node.config.url) return `"Webhook Call" is missing a URL.`;
        if (node.actionType === 'execute_automation' && !node.config.workflow_id) return `"Execute Automation" has no workflow selected.`;
        if (node.actionType === 'add_tag' && !(node.config.tag || (node.config.tags as string[])?.length)) return `"Add Tag" is missing at least one tag.`;
        if (node.actionType === 'create_followup' && !node.config.title) return `"Create Follow-up" is missing a title.`;
      }
      if (node.type === 'condition') {
        const conditions = node.config.conditions as Array<{ field: string; operator: string }> | undefined;
        if (conditions && conditions.length > 0) {
          const incomplete = conditions.some((c) => !c.field || !c.operator);
          if (incomplete) return `"If/Else" has an incomplete condition rule — set all fields and operators.`;
        } else if (!node.config.field || !node.config.operator) {
          return `"If/Else" condition is incomplete — set the field and operator.`;
        }
      }
      if (node.branches?.yes) { const err = validateNodes(node.branches.yes); if (err) return err; }
      if (node.branches?.no)  { const err = validateNodes(node.branches.no);  if (err) return err; }
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validateNodes(workflow.nodes);
    if (validationError) { toast.error(validationError); return; }
    setSaving(true);
    // Cancel any pending debounced autosave so it can't race the hard save.
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    const ok = await persist();
    if (!ok) {
      // persist() already showed a specific message (conflict → reloaded, or
      // transient → retrying). Don't show a misleading generic error.
      setSaving(false);
      return;
    }
    // Hard-verify: read the workflow back and confirm every node persisted.
    try {
      const server = await api.get<any>(`/api/workflows/${workflow.id}`);
      const raw = server?.nodes;
      const serverNodes = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
      const sent = countNodes(workflowRef.current.nodes);
      const got = countNodes(serverNodes);
      if (got !== sent) {
        setSaveStatus('error');
        setIsDirty(true);
        toast.error('Save could not be verified — please click Save again.');
        setSaving(false);
        return;
      }
    } catch { /* verification fetch failed; PATCH already succeeded — treat as saved */ }
    // Snapshot version on every verified save (Task #12)
    api.post(`/api/workflows/${workflow.id}/snapshot`, {
      name: workflow.name,
      nodes: workflow.nodes,
    }).catch(() => null);
    toast.success(workflow.status === 'inactive'
      ? 'Saved ✓ — click Publish to activate it'
      : 'Saved ✓ all changes stored');
    setSaving(false);
  };

  const updateNode = (nodeId: string, updates: Partial<WFNode>) => {
    setWorkflow((w) => ({
      ...w,
      nodes: w.nodes.map((n) => n.id === nodeId ? { ...n, ...updates } : n),
    }));
  };

  const updateBranchNode = (_parentId: string, _branch: 'yes' | 'no', nodeId: string, updates: Partial<WFNode>) => {
    setWorkflow((w) => ({ ...w, nodes: updateNodeById(w.nodes, nodeId, updates) }));
  };

  const deleteNode = (nodeId: string) => {
    if (workflow.nodes.length === 1) { toast.error('A workflow must have at least one node'); return; }
    setWorkflow((w) => ({ ...w, nodes: w.nodes.filter((n) => n.id !== nodeId) }));
    setSelectedNodeId(workflow.nodes[0]?.id ?? null);
    setSelectedBranchCtx(null);
  };

  const deleteBranchNode = (nodeId: string) => {
    setWorkflow((w) => ({ ...w, nodes: deleteNodeById(w.nodes, nodeId) }));
    setSelectedBranchCtx(null);
    setSelectedNodeId(null);
  };

  const handleSelectTrigger = (_source: string, type: string, label: string) => {
    updateNode(workflow.nodes[0].id, { actionType: type, label, config: {} });
    setShowTriggerPicker(false);
    setSelectedNodeId(workflow.nodes[0].id);
    setSelectedBranchCtx(null);
    setShowNodeModal(true);
    toast.success(`Trigger set: ${label}`);
  };

  const handleSelectAction = (action: typeof ACTION_LIST[0]) => {
    // "Change action" mode — update existing selected node in-place instead of inserting
    if (changeActionMode && selectedNode) {
      const patch: Partial<WFNode> = {
        type: action.id === 'delay' ? 'delay' : action.id === 'if_else' ? 'condition' : 'action',
        actionType: action.id,
        label: action.label,
        config: {},
        branches: action.id === 'if_else' ? { yes: [], no: [] } : undefined,
      };
      if (selectedBranchCtx) {
        updateBranchNode('', 'yes', selectedNode.id, patch);
      } else if (selectedNodeId) {
        updateNode(selectedNodeId, patch);
      }
      setChangeActionMode(false);
      setShowActionPicker(false);
      setShowNodeModal(true);
      return;
    }

    const newNode: WFNode = {
      id: `n-${Date.now()}`,
      type: action.id === 'delay' ? 'delay' : action.id === 'if_else' ? 'condition' : 'action',
      actionType: action.id,
      label: action.label,
      config: {},
      branches: action.id === 'if_else' ? { yes: [], no: [] } : undefined,
    };

    if (insertBranchCtx) {
      // Adding to a branch (works for nested branches via insertIntoBranch)
      const { parentId, branch, afterIndex } = insertBranchCtx;
      setWorkflow((w) => ({ ...w, nodes: insertIntoBranch(w.nodes, parentId, branch, afterIndex, newNode) }));
      setSelectedBranchCtx({ nodeId: newNode.id, branch });
      setSelectedNodeId(null);
    } else {
      // Adding to main canvas
      const idx = insertAfterIndex ?? workflow.nodes.length - 1;
      const newNodes = [...workflow.nodes];
      newNodes.splice(idx + 1, 0, newNode);
      setWorkflow((w) => ({ ...w, nodes: newNodes }));
      setSelectedNodeId(newNode.id);
      setSelectedBranchCtx(null);
    }

    setShowActionPicker(false);
    setInsertAfterIndex(null);
    setInsertBranchCtx(null);
    setShowNodeModal(true);
  };

  const handleAddBranchAction = (parentId: string, branch: 'yes' | 'no', afterIndex: number) => {
    setInsertBranchCtx({ parentId, branch, afterIndex });
    setInsertAfterIndex(null);
    setShowActionPicker(true);
  };

  const handleRegenerateToken = async () => {
    if (!workflow.id || workflow.id === 'new') return;
    try {
      const res = await api.post<{ api_token: string }>(`/api/workflows/${workflow.id}/regenerate-token`, {});
      setWorkflow((w) => ({ ...w, apiToken: res.api_token }));
      toast.success('API token regenerated');
    } catch { toast.error('Failed to regenerate token'); }
  };

  const handleAIGenerate = () => {
    if (!aiPrompt.trim() || !selectedNode) return;
    const sample = `Hi {%first_name%},\n\nThank you for your interest! ${aiPrompt}\n\nLooking forward to hearing from you.\n\nBest regards,\nYour Team`;
    const field = selectedNode.actionType === 'send_email' ? 'content' : selectedNode.actionType === 'create_note' ? 'noteContent' : 'message';
    if (selectedBranchCtx) {
      updateBranchNode('', 'yes', selectedNode.id, { config: { ...selectedNode.config, [field]: sample } });
    } else {
      updateNode(selectedNode.id, { config: { ...selectedNode.config, [field]: sample } });
    }
    setPreviewContent(sample.replace('{%first_name%}', 'John'));
    setShowAIPanel(false);
    toast.success('Content generated');
  };

  const isPanelOpen = selectedNode !== null;

  // Determine if selected node is trigger (for showing Change Trigger button)
  const selectedNodeIsTrigger = !selectedBranchCtx && selectedNode?.type === 'trigger';
  const selectedNodeIsCondition = selectedNode?.type === 'condition';

  const isCommNode = selectedNode && ['send_email','send_sms','send_whatsapp','internal_notify','create_note'].includes(selectedNode.actionType);

  // ── Go-Live gate ──────────────────────────────────────────────────────────────
  const FORM_TRIGGER_TYPES = ['opt_in_form', 'meta_form', 'product_enquired'];
  const triggerNode = workflow.nodes.find((n) => n.type === 'trigger');
  const triggerType = triggerNode?.actionType ?? '';
  const triggerCfg  = triggerNode?.config ?? {};
  const goLiveBlockReason = (() => {
    if (!triggerType) return 'Select a trigger before going live';
    if (FORM_TRIGGER_TYPES.includes(triggerType) && ((triggerCfg.forms as string[]) ?? []).length === 0)
      return 'Select at least one form before going live';
    if (triggerType === 'calendar_form_submitted' && ((triggerCfg.calendars as string[]) ?? []).length === 0)
      return 'Select at least one calendar before going live';
    if (triggerType === 'contact_tagged' && ((triggerCfg.tags as string[]) ?? []).length === 0)
      return 'Select at least one tag before going live';
    return null;
  })();
  const canGoLive = goLiveBlockReason === null;

  const publishStyle = workflow.status === 'active'
    ? { background: '#1c1410' }
    : { background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))', boxShadow: '0 2px 8px rgba(234,88,12,0.3)' };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#f0ece7' }}>

      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.06] bg-white shrink-0 z-10" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

        {/* Left: back + breadcrumb */}
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate('/automation')} className="p-1.5 rounded-lg hover:bg-[var(--app-bg)] text-[#7a6b5c] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="text-[#b09e8d]">Workflows</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#c4b09e]" />
            {isEditingName ? (
              <input autoFocus className="font-bold text-[#1c1410] border-b-2 border-primary outline-none bg-transparent min-w-32" value={workflow.name} onChange={(e) => setWorkflow((w) => ({ ...w, name: e.target.value }))} onBlur={() => setIsEditingName(false)} onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)} />
            ) : (
              <button onClick={() => setIsEditingName(true)} className="font-bold text-[#1c1410] hover:text-primary flex items-center gap-1.5 transition-colors">
                {workflow.name}
                <Pencil className="w-3 h-3 text-[#c4b09e]" />
              </button>
            )}
          </div>
        </div>

        {/* Center: testing mode pill */}
        <div
          className="flex items-center gap-2 bg-[var(--app-bg)] border border-black/[0.06] rounded-xl px-3.5 py-1.5"
          title={!canGoLive && workflow.status !== 'active' ? goLiveBlockReason ?? undefined : undefined}
        >
          <span className="text-[11px] font-semibold text-[#7a6b5c]">Testing mode</span>
          <span className={cn(!canGoLive && workflow.status !== 'active' && 'opacity-40 cursor-not-allowed')}>
            <Switch
              checked={workflow.status === 'active'}
              disabled={!canGoLive && workflow.status !== 'active'}
              onCheckedChange={(v) => {
                if (v && !canGoLive) { toast.error(goLiveBlockReason!); return; }
                setWorkflow((w) => ({ ...w, status: v ? 'active' : 'inactive' }));
              }}
            />
          </span>
          <span className={cn('text-[11px] font-bold', workflow.status === 'active' ? 'text-emerald-600' : 'text-[#b09e8d]')}>
            {workflow.status === 'active' ? 'Live' : canGoLive ? 'Off' : 'Testing'}
          </span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' ? (
            <span className="text-[10px] text-[#b09e8d] flex items-center gap-1 mr-1">
              <RefreshCw className="w-3 h-3 animate-spin" />Saving…
            </span>
          ) : saveStatus === 'error' ? (
            <button onClick={() => persist()} className="text-[10px] text-red-600 flex items-center gap-1 mr-1 hover:underline" title="Save failed — click to retry">
              <AlertTriangle className="w-3 h-3" />Unsaved — retry
            </button>
          ) : (
            <span className="text-[10px] text-[#b09e8d] flex items-center gap-1 mr-1">
              <Clock className="w-3 h-3" />{isDirty ? 'Unsaved changes' : (savedAt ? `Saved ${relativeSince(savedAt)}` : 'Not saved yet')}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate(`/automation/analytics/${workflow.id}`)} className="h-8 text-[12px] border-black/[0.1]">
            <TrendingUp className="w-3.5 h-3.5 mr-1" />Analytics
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="h-8 text-[12px] border-black/[0.1]">
            {saving ? 'Saving…' : <><Save className="w-3.5 h-3.5 mr-1" />Save</>}
          </Button>
          <Button size="sm" onClick={() => setShowTestModal(true)} className="h-8 text-[12px] bg-[#1c1410] hover:bg-black text-white">
            <Play className="w-3 h-3 mr-1" />Test
          </Button>
          <button
            onClick={() => {
              const hasActions = workflow.nodes.some((n) => n.type === 'action');
              if (workflow.status === 'inactive') {
                if (!triggerType) { setShowNoTriggerPopup(true); return; }
                if (goLiveBlockReason) { toast.error(goLiveBlockReason); return; }
                if (!hasActions) { toast.error('Add at least one action node before publishing'); return; }
              }
              setWorkflow((w) => ({ ...w, status: w.status === 'active' ? 'inactive' : 'active' }));
            }}
            className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-bold text-white transition-all"
            style={publishStyle}
          >
            {workflow.status === 'active' ? <><PauseCircle className="w-3.5 h-3.5" /><span className="ml-1">Pause</span></> : <><Play className="w-3.5 h-3.5" /><span className="ml-1">Publish</span></>}
          </button>
          <div className="relative" ref={menuRef}>
            <button onClick={() => setShowMenuDropdown((v) => !v)} className="w-8 h-8 rounded-lg border border-black/[0.08] hover:bg-[var(--app-bg)] flex items-center justify-center transition-colors">
              <Settings className="w-3.5 h-3.5 text-[#7a6b5c]" />
            </button>
            {showMenuDropdown && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-black/[0.06] rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] text-left transition-colors" onClick={() => { setShowMenuDropdown(false); setShowSettingsModal(true); }}>
                  <Settings className="w-3.5 h-3.5 text-[#7a6b5c]" /> Workflow Settings
                </button>
                <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] text-left transition-colors" onClick={() => { setShowMenuDropdown(false); toast.info('Workflow duplicated'); }}>
                  <Copy className="w-3.5 h-3.5 text-[#7a6b5c]" /> Duplicate Workflow
                </button>
                <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] text-left transition-colors" onClick={() => { setShowMenuDropdown(false); navigate('/automation'); }}>
                  <ClipboardList className="w-3.5 h-3.5 text-[#7a6b5c]" /> Execution Logs
                </button>
                <div className="border-t border-black/[0.05] my-1" />
                <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-red-500 hover:bg-red-50 text-left transition-colors" onClick={() => { setShowMenuDropdown(false); setShowDeleteWorkflowConfirm(true); }}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete Workflow
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Inactive warning banner ── */}
      {workflow.status === 'inactive' && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-[12px] font-medium">
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          This workflow is not published. It will not run until you click <strong className="ml-1 mr-1">Publish</strong> in the top-right corner.
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Canvas ── */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{ backgroundImage: 'radial-gradient(circle, #c8bfb4 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          {/* Scrollable inner canvas */}
          <div
            className="absolute inset-0 overflow-auto"
            onClick={() => { setSelectedNodeId(null); setSelectedBranchCtx(null); }}
          >
          {/* Loading overlay on refresh */}
          {loadingWF && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#f0ece7]/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-[13px] font-semibold text-[#7a6b5c]">Loading workflow…</p>
              </div>
            </div>
          )}

          {/* Nodes */}
          <div
            className="flex flex-col items-center py-16 min-h-full"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}
            onClick={(e) => e.stopPropagation()}
          >
            {workflow.nodes.map((node, idx) => (
              <CanvasNode
                key={node.id} node={node} idx={idx}
                selectedNodeId={selectedBranchCtx ? null : selectedNodeId}
                onSelectNode={(nodeId) => {
                  const n = workflow.nodes.find((x) => x.id === nodeId);
                  setSelectedNodeId(nodeId);
                  setSelectedBranchCtx(null);
                  if (n?.type === 'trigger' && !n.actionType) {
                    setShowTriggerPicker(true);
                  } else {
                    setShowNodeModal(true);
                  }
                }}
                onInsertAfter={(i) => { setInsertAfterIndex(i); setInsertBranchCtx(null); setShowActionPicker(true); }}
                onAddBranchAction={handleAddBranchAction}
                onDeleteBranchNode={deleteBranchNode}
                onSelectBranchNode={(nodeId, branch) => {
                  setSelectedBranchCtx({ nodeId, branch });
                  setSelectedNodeId(null);
                  setShowNodeModal(true);
                }}
                testStatus={
                  testRunning
                    ? (node.type === 'trigger' ? undefined : 'pending')
                    : testNodeResults[node.id]
                      ? (testNodeResults[node.id].status === 'completed' ? 'completed' : testNodeResults[node.id].status === 'failed' ? 'failed' : 'skipped')
                      : undefined
                }
              />
            ))}
            {/* End node */}
            <div className="flex flex-col items-center">
              <div style={{ width: 0, height: 28, borderLeft: '2px dashed #d4c8bd' }} />
              <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/70 border border-[#e8e0d8] text-[#b09e8d] text-[11px] font-bold shadow-sm">
                <div className="w-2 h-2 rounded-full bg-[#c4b09e]" /> End of Flow
              </div>
            </div>
          </div>

          {/* ── Preview floating card (bottom-left) ── */}
          {previewContent && (
            <div className="absolute bottom-20 left-5 w-64 bg-white rounded-2xl shadow-2xl border border-black/[0.06] z-20 overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[var(--app-bg)]">
                <span className="text-[13px] font-bold text-[#1c1410]">Preview</span>
                <button onClick={() => setPreviewContent(null)} className="w-5 h-5 rounded-md hover:bg-gray-200 flex items-center justify-center transition-colors">
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              </div>
              <div className="p-4 text-[11px] text-[#4a3c30] leading-relaxed max-h-52 overflow-y-auto whitespace-pre-line">{previewContent}</div>
            </div>
          )}

          </div>{/* end scrollable inner canvas */}

          {/* ── Bottom toolbar — anchored to canvas viewport, never scrolls ── */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1c1410] rounded-2xl px-3 py-2 shadow-xl z-20">
            <button title="Undo" onClick={() => {}} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button title="Redo" onClick={() => {}} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <ArrowRight className="w-3.5 h-3.5 scale-x-[-1]" />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1" />
            <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setZoom(100)} className="min-w-[40px] text-center text-[11px] font-mono text-white/60 hover:text-white transition-colors">{zoom}%</button>
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/20 mx-1" />
            {[
              { Icon: Maximize2, title: 'Fit view', action: () => setZoom(100) },
              { Icon: GitBranch, title: 'Add condition', action: () => { setInsertAfterIndex(workflow.nodes.length - 1); setInsertBranchCtx(null); setShowActionPicker(true); } },
              { Icon: MessageSquare, title: 'Add communication', action: () => { setInsertAfterIndex(workflow.nodes.length - 1); setInsertBranchCtx(null); setShowActionPicker(true); } },
            ].map(({ Icon, title, action }) => (
              <button key={title} title={title} onClick={action} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>

        {/* ── Right Config Panel — resizable ── */}
        <div
          className="bg-white border-l border-black/[0.06] flex flex-col shrink-0 overflow-hidden relative transition-[width] duration-200"
          style={{ width: isPanelOpen ? panelWidth : 0, boxShadow: isPanelOpen ? '-2px 0 8px rgba(0,0,0,0.04)' : 'none' }}
        >
          {/* Drag handle */}
          {isPanelOpen && (
            <div onMouseDown={onDragStart} className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-10 group" title="Drag to resize">
              <div className="w-full h-full group-hover:bg-primary/20 transition-colors" />
            </div>
          )}

          {selectedNode && (
            <>
              {/* Panel header */}
              <div className="px-5 pt-4 pb-0 border-b border-black/[0.06] shrink-0">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', nodeAccent(selectedNode.type).icon)}>
                      <NodeIconRenderer actionType={selectedNode.actionType} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold text-[#1c1410] leading-snug">{selectedNode.label || 'Configure Node'}</p>
                      <p className="text-[10px] text-[#7a6b5c]">
                        {selectedNode.type === 'trigger' ? 'Starts the workflow' : selectedNode.type === 'condition' ? 'Splits into branches' : 'Action step'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { if (selectedBranchCtx) deleteBranchNode(selectedBranchCtx.nodeId); else if (selectedNodeId) deleteNode(selectedNodeId); }}
                    className="w-7 h-7 rounded-lg hover:bg-red-50 text-[#b09e8d] hover:text-red-500 flex items-center justify-center transition-colors"
                    title="Delete node"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {selectedBranchCtx && (
                  <div className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mb-2',
                    selectedBranchCtx.branch === 'yes' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                  )}>
                    <GitBranch className="w-3 h-3" />
                    {selectedBranchCtx.branch === 'yes' ? 'YES' : 'NO'} branch
                  </div>
                )}

                {/* Tabs: Settings | History | Preview */}
                <div className="flex gap-0">
                  {(isCommNode ? ['settings', 'history', 'preview'] : ['settings', 'history'] as const).map((tab) => (
                    <button key={tab} onClick={() => setPanelTab(tab as any)}
                      className={cn('pb-2.5 px-0.5 text-[12px] font-semibold border-b-2 transition-colors capitalize mr-4',
                        panelTab === tab ? 'border-primary text-primary' : 'border-transparent text-[#7a6b5c] hover:text-[#1c1410]'
                      )}>
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {panelTab === 'history' ? (
                  <div className="space-y-2">
                    {['Just now', '2 min ago', '10 min ago', 'Yesterday'].map((t, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-black/[0.04]">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-[12px] font-semibold text-[#1c1410]">Node saved</p>
                          <p className="text-[10px] text-[#7a6b5c]">{t}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : panelTab === 'preview' ? (
                  <div className="space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Message Preview</p>
                    <div className="rounded-xl border border-black/[0.06] bg-[var(--app-bg)] p-4 space-y-3">
                      {selectedNode?.actionType === 'send_email' && (
                        <>
                          <div className="text-[11px] text-[#7a6b5c]"><span className="font-bold text-[#1c1410]">From:</span> {(selectedNode.config.fromName as string) || 'Your Team'}</div>
                          <div className="text-[11px] text-[#7a6b5c]"><span className="font-bold text-[#1c1410]">Subject:</span> {(selectedNode.config.subject as string) || '(no subject)'}</div>
                          <div className="border-t border-black/[0.06] pt-3 text-[12px] text-[#4a3c30] leading-relaxed whitespace-pre-line">
                            {((selectedNode.config.content as string) || 'No content yet.').replace('{%first_name%}', 'John').replace('{%email%}', 'john@example.com')}
                          </div>
                        </>
                      )}
                      {(selectedNode?.actionType === 'send_sms' || selectedNode?.actionType === 'send_whatsapp') && (
                        <div className="text-[12px] text-[#4a3c30] leading-relaxed whitespace-pre-line">
                          {((selectedNode.config.message as string) || 'No message yet.').replace('{%first_name%}', 'John')}
                        </div>
                      )}
                      {selectedNode?.actionType === 'internal_notify' && (
                        <div className="text-[12px] text-[#4a3c30] leading-relaxed">
                          {(selectedNode.config.message as string) || 'No message yet.'}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-[#b09e8d]">Variables like {'{%first_name%}'} are shown with sample values.</p>
                  </div>
                ) : (
                  <>
                    {/* AI Generate section for communication nodes */}
                    {isCommNode && (
                      <div className="rounded-xl border border-purple-100 overflow-hidden">
                        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center">
                              <Bot className="w-3.5 h-3.5 text-purple-600" />
                            </div>
                            <span className="text-[12px] font-bold text-purple-800">AI Generate</span>
                          </div>
                          <button onClick={() => setShowAIPanel(!showAIPanel)} className="text-[11px] text-purple-600 font-bold hover:text-purple-800 transition-colors">
                            {showAIPanel ? 'Hide ↑' : 'Use AI ✦'}
                          </button>
                        </div>
                        {showAIPanel && (
                          <div className="p-4 bg-white space-y-3">
                            <textarea
                              className="w-full border border-purple-100 rounded-xl px-3 py-2.5 text-[12px] bg-purple-50/50 focus:border-purple-300 outline-none resize-none placeholder:text-purple-300"
                              rows={3}
                              placeholder="Describe what to generate… e.g. Follow-up email for sales leads"
                              value={aiPrompt}
                              onChange={(e) => setAIPrompt(e.target.value)}
                            />
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { label: 'Tone', value: aiTone, set: setAITone, opts: ['Professional','Friendly','Formal','Casual'] },
                                { label: 'Format', value: aiFormat, set: setAIFormat, opts: ['Email','SMS','WhatsApp'] },
                                { label: 'Length', value: aiLength, set: setAILength, opts: ['Short','Medium','Long'] },
                              ].map(({ label, value, set, opts }) => (
                                <div key={label}>
                                  <p className="text-[9px] font-bold text-[#7a6b5c] uppercase tracking-wide mb-1">{label}</p>
                                  <select className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white focus:border-purple-300" value={value} onChange={(e) => set(e.target.value)}>
                                    {opts.map((o) => <option key={o}>{o}</option>)}
                                  </select>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-3">
                              <label className="flex items-center gap-1.5 text-[11px] text-[#7a6b5c] cursor-pointer">
                                <input type="checkbox" className="rounded accent-purple-500" defaultChecked /> Personalize with name
                              </label>
                              <label className="flex items-center gap-1.5 text-[11px] text-[#7a6b5c] cursor-pointer">
                                <input type="checkbox" className="rounded accent-purple-500" defaultChecked /> Include CTA
                              </label>
                            </div>
                            <button
                              onClick={handleAIGenerate}
                              disabled={!aiPrompt.trim()}
                              className="w-full py-2.5 rounded-xl text-[12px] font-bold text-white transition-all disabled:opacity-40"
                              style={{ background: 'linear-gradient(135deg, #7c3aed, #9333ea)', boxShadow: '0 2px 8px rgba(124,58,237,0.3)' }}
                            >
                              ✦ Generate Content
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Main config */}
                    {selectedNode.type === 'trigger'
                      ? <TriggerConfigPanel node={selectedNode} onUpdate={(u) => updateNode(selectedNode.id, u)} onChangeTrigger={() => setShowTriggerPicker(true)} pipelines={editorPipelines} staff={editorStaff} forms={editorForms} metaForms={editorMetaForms} eventTypes={editorEventTypes} bookingLinks={editorBookingLinks} metaPages={editorMetaPages} webhookUrls={editorWebhookUrls} contactGroups={editorContactGroups} sheetConfigs={editorSheetConfigs} allowReentry={workflow.allowReentry} onToggleReentry={(val) => setWorkflow((w) => ({ ...w, allowReentry: val }))} workflowId={workflow.id} apiToken={workflow.apiToken} onRegenerateToken={handleRegenerateToken} />
                      : selectedNodeIsCondition
                      ? <ConditionConfigPanel node={selectedNode} onUpdate={(u) => selectedBranchCtx ? updateBranchNode('', 'yes', selectedNode.id, u) : updateNode(selectedNode.id, u)} pipelines={editorPipelines} staff={editorStaff} />
                      : <ActionConfigPanel node={selectedNode} onUpdate={(u) => selectedBranchCtx ? updateBranchNode('', 'yes', selectedNode.id, u) : updateNode(selectedNode.id, u)} pipelines={editorPipelines} staff={editorStaff} templates={editorTemplates} workflows={editorWorkflows} routingSets={editorRoutingSets} contactGroups={editorContactGroups} onRefreshPipelines={refreshPipelines} refreshingPipelines={refreshingPipelines} />
                    }
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-2 px-5 py-4 border-t border-black/[0.06] shrink-0 bg-[var(--app-bg)]">
                <Button className="flex-1 text-[12px]" style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))', color: 'white' }} onClick={() => toast.success('Step saved')}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Save Step
                </Button>
                {selectedNodeIsTrigger && (
                  <Button variant="outline" className="flex-1 border-primary/30 text-primary hover:bg-primary/5 text-[12px]" onClick={() => setShowTriggerPicker(true)}>
                    Change Trigger
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Node Config Modal ── */}
      {showNodeModal && selectedNode && (
        <NodeConfigModal
          node={selectedNode}
          branchCtx={selectedBranchCtx}
          onClose={() => setShowNodeModal(false)}
          onUpdate={(u) => selectedBranchCtx
            ? updateBranchNode('', 'yes', selectedNode.id, u)
            : updateNode(selectedNode.id, u)
          }
          onDelete={() => {
            if (selectedBranchCtx) deleteBranchNode(selectedBranchCtx.nodeId);
            else if (selectedNodeId) deleteNode(selectedNodeId);
            setShowNodeModal(false);
          }}
          onChangeTrigger={() => { setShowNodeModal(false); setShowTriggerPicker(true); }}
          onChangeAction={() => { setShowNodeModal(false); setChangeActionMode(true); setInsertAfterIndex(null); setInsertBranchCtx(null); setShowActionPicker(true); }}
          pipelines={editorPipelines}
          staff={editorStaff}
          forms={editorForms}
          metaForms={editorMetaForms}
          eventTypes={editorEventTypes}
          bookingLinks={editorBookingLinks}
          metaPages={editorMetaPages}
          webhookUrls={editorWebhookUrls}
          templates={editorTemplates}
          workflows={editorWorkflows}
          routingSets={editorRoutingSets}
          contactGroups={editorContactGroups}
          sheetConfigs={editorSheetConfigs}
          showAIPanel={showAIPanel}
          setShowAIPanel={setShowAIPanel}
          aiPrompt={aiPrompt} setAIPrompt={setAIPrompt}
          aiTone={aiTone} setAITone={setAITone}
          aiFormat={aiFormat} setAIFormat={setAIFormat}
          aiLength={aiLength} setAILength={setAILength}
          onAIGenerate={handleAIGenerate}
          allowReentry={workflow.allowReentry}
          onToggleReentry={(val) => setWorkflow((w) => ({ ...w, allowReentry: val }))}
          onRefreshPipelines={refreshPipelines}
          refreshingPipelines={refreshingPipelines}
          workflowId={workflow.id}
          apiToken={workflow.apiToken}
          onRegenerateToken={handleRegenerateToken}
        />
      )}

      {/* Modals */}
      {showTriggerPicker && (
        <TriggerPickerModal onClose={() => setShowTriggerPicker(false)} onSelect={handleSelectTrigger} />
      )}
      {showActionPicker && (
        <ActionPickerModal
          onClose={() => { setShowActionPicker(false); setInsertAfterIndex(null); setInsertBranchCtx(null); if (changeActionMode) { setChangeActionMode(false); setShowNodeModal(true); } }}
          onSelect={handleSelectAction}
        />
      )}
      {showSettingsModal && (
        <WorkflowSettingsModal
          workflow={workflow}
          onClose={() => setShowSettingsModal(false)}
          onSave={(updates) => { setWorkflow((w) => ({ ...w, ...updates })); toast.success('Settings saved'); }}
        />
      )}
      {showTestModal && (
        <TestWorkflowModal
          workflowId={workflow.id}
          onClose={() => { setShowTestModal(false); setTestRunning(false); }}
          onTestStart={() => { setTestRunning(true); setTestNodeResults({}); }}
          onTestDone={(results) => { setTestRunning(false); setTestNodeResults(results); }}
        />
      )}
      {showNoTriggerPopup && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowNoTriggerPopup(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <span className="text-amber-600 text-lg font-bold">!</span>
            </div>
            <h3 className="text-[15px] font-bold text-[#1c1410] mb-2">No Trigger Set</h3>
            <p className="text-[13px] text-[#7a6b5c] mb-6">A workflow must have a trigger before it can be published. Choose a trigger from the trigger node first.</p>
            <button
              onClick={() => setShowNoTriggerPopup(false)}
              className="w-full py-2.5 rounded-xl bg-[var(--brand-dark)] hover:bg-[var(--brand)] text-white text-[13px] font-bold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {showDeleteWorkflowConfirm && (
        <ConfirmModal
          title="Delete Workflow?"
          message={<>Delete <span className="font-semibold text-[#1c1410]">"{workflow.name}"</span>? All execution history will be lost. This cannot be undone.</>}
          confirmLabel="Yes, Delete"
          onConfirm={async () => {
            await api.delete(`/api/workflows/${workflow.id}`);
            toast.success('Deleted');
            navigate('/automation');
          }}
          onClose={() => setShowDeleteWorkflowConfirm(false)}
        />
      )}
    </div>
  );
}
