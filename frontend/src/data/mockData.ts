import { format, subHours, subDays, subMinutes, addDays, addHours } from 'date-fns';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: string;
  stageId: string;
  pipelineId: string;
  assignedTo: string;
  assignedName?: string;
  source: string;
  meta_form_name?: string;
  tags: string[];
  score: number;
  dealValue: number;
  createdAt: string;
  lastActivity: string;
  notes: string[];
  customFields?: { label: string; value: string; fieldId?: string }[];
  leadQuality?: string;
  teamMembers?: string[];
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff';
  status: 'active' | 'inactive';
  leadsAssigned: number;
  lastActive: string;
  avatar: string;
  phone?: string;
}

export interface Conversation {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  channel: 'whatsapp';
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  status: 'open' | 'pending' | 'resolved';
  assignedTo: string;
  messages: Message[];
}

export interface Message {
  id: string;
  text: string;
  sender: 'customer' | 'agent';
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  isNote?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: string;
  status: 'active' | 'inactive';
  executions: number;
  lastRun: string;
  actions: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  type: 'meeting' | 'demo' | 'call';
  leadName: string;
  email?: string;
  assignedTo: string;
  date: string;
  time: string;
  duration: number;
  status: 'scheduled' | 'completed' | 'no-show' | 'cancelled';
  meetingLink?: string;
  notes?: string;
  createdBy?: string;
  createdByName?: string;
}

export interface Notification {
  id: string;
  type: 'new_lead' | 'assigned' | 'automation' | 'info' | 'lead_created' | 'stage_changed' | 'new_message' | 'follow_up_due' | 'appointment';
  category: 'alert' | 'activity';
  title: string;   // bold first line
  body: string;    // muted context line
  time: string;
  read: boolean;
  leadId?: string;
}

export const STAGES = ['New Leads', 'Contacted', 'Qualified', 'Proposal Sent', 'Closed Won'];

export const PIPELINES = [
  { id: 'sales', name: 'Sales Pipeline' },
  { id: 'support', name: 'Support Pipeline' },
  { id: 'onboarding', name: 'Onboarding Pipeline' },
  { id: 'ads', name: 'Sales Ads Pipeline' },
];

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  is_won?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

export const pipelines: Pipeline[] = [
  { id: 'sales', name: 'Sales Pipeline', stages: [
    { id: 'sl1', name: 'New Lead', color: '#6366f1' },
    { id: 'sl2', name: 'Contacted', color: '#f59e0b' },
    { id: 'sl3', name: 'Qualified', color: '#10b981' },
    { id: 'sl4', name: 'Proposal Sent', color: '#3b82f6' },
    { id: 'sl5', name: 'Won', color: '#22c55e' },
    { id: 'sl6', name: 'Lost', color: '#ef4444' },
  ]},
  { id: 'support', name: 'Support Pipeline', stages: [
    { id: 'sp1', name: 'Open', color: '#6366f1' },
    { id: 'sp2', name: 'In Progress', color: '#f59e0b' },
    { id: 'sp3', name: 'Resolved', color: '#10b981' },
    { id: 'sp4', name: 'Closed', color: '#ef4444' },
  ]},
  { id: 'onboarding', name: 'Onboarding Pipeline', stages: [
    { id: 'ob1', name: 'Signed Up', color: '#6366f1' },
    { id: 'ob2', name: 'Setup', color: '#f59e0b' },
    { id: 'ob3', name: 'Training', color: '#3b82f6' },
    { id: 'ob4', name: 'Go Live', color: '#22c55e' },
  ]},
  { id: 'ads', name: 'Sales Ads Pipeline', stages: [
    { id: 'ad1', name: 'Ad Click', color: '#6366f1' },
    { id: 'ad2', name: 'Form Filled', color: '#8b5cf6' },
    { id: 'ad3', name: 'First Call', color: '#f59e0b' },
    { id: 'ad4', name: 'Follow Up 1', color: '#f97316' },
    { id: 'ad5', name: 'Follow Up 2', color: '#3b82f6' },
    { id: 'ad6', name: 'Demo Done', color: '#10b981' },
    { id: 'ad7', name: 'Proposal Sent', color: '#06b6d4' },
    { id: 'ad8', name: 'Negotiation', color: '#ec4899' },
    { id: 'ad9', name: 'Won', color: '#22c55e' },
    { id: 'ad10', name: 'Lost', color: '#ef4444' },
  ]},
];

const firstNames = ['Ranjith', 'Priya', 'Amit', 'Sara', 'Vikram', 'Ananya', 'Karthik', 'Deepa', 'Suresh', 'Meera', 'Arjun', 'Nisha', 'Rohit', 'Kavitha', 'Arun'];
const lastNames = ['Kumar', 'Sharma', 'Patel', 'Reddy', 'Singh', 'Nair', 'Gupta', 'Joshi', 'Menon', 'Das'];
const companies = ['Saral Bakery', 'TechWave Solutions', 'GreenLeaf Organics', 'UrbanEdge Realty', 'SparkDigital Media', 'FreshBite Foods', 'CloudNine Software', 'BlueHarbor Logistics'];
const sources = ['Meta Forms', 'WhatsApp', 'Custom Form', 'Manual', 'Landing Page'];
const tagsList = ['Hot Lead', 'Enterprise', 'SMB', 'Follow Up', 'Demo Scheduled', 'Price Sent', 'Urgent', 'VIP'];

export const staff: StaffMember[] = [
  { id: 's1', name: 'Ranjith Kumar', email: 'ranjith@nexcrm.com', role: 'admin', status: 'active', leadsAssigned: 45, lastActive: subMinutes(new Date(), 5).toISOString(), avatar: 'RK' },
  { id: 's2', name: 'Priya Sharma', email: 'priya@nexcrm.com', role: 'admin', status: 'active', leadsAssigned: 38, lastActive: subMinutes(new Date(), 15).toISOString(), avatar: 'PS' },
  { id: 's3', name: 'Amit Patel', email: 'amit@nexcrm.com', role: 'staff', status: 'active', leadsAssigned: 52, lastActive: subHours(new Date(), 1).toISOString(), avatar: 'AP' },
  { id: 's4', name: 'Sara Reddy', email: 'sara@nexcrm.com', role: 'staff', status: 'active', leadsAssigned: 41, lastActive: subHours(new Date(), 2).toISOString(), avatar: 'SR' },
  { id: 's5', name: 'Vikram Singh', email: 'vikram@nexcrm.com', role: 'staff', status: 'active', leadsAssigned: 67, lastActive: subMinutes(new Date(), 30).toISOString(), avatar: 'VS' },
  { id: 's6', name: 'Ananya Nair', email: 'ananya@nexcrm.com', role: 'staff', status: 'active', leadsAssigned: 55, lastActive: subHours(new Date(), 3).toISOString(), avatar: 'AN' },
  { id: 's7', name: 'Karthik Gupta', email: 'karthik@nexcrm.com', role: 'staff', status: 'inactive', leadsAssigned: 23, lastActive: subDays(new Date(), 3).toISOString(), avatar: 'KG' },
  { id: 's8', name: 'Deepa Joshi', email: 'deepa@nexcrm.com', role: 'staff', status: 'active', leadsAssigned: 49, lastActive: subHours(new Date(), 1).toISOString(), avatar: 'DJ' },
];

function generateLeads(): Lead[] {
  const result: Lead[] = [];
  for (let i = 0; i < 60; i++) {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[i % lastNames.length];
    const pipeline = pipelines[i % pipelines.length];
    const pipelineStage = pipeline.stages[i % pipeline.stages.length];
    result.push({
      id: `lead-${i + 1}`,
      firstName: fn,
      lastName: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${companies[i % companies.length].toLowerCase().replace(/\s/g, '')}.com`,
      phone: `+91 ${9000000000 + i * 1111}`,
      stage: pipelineStage.name,
      stageId: pipelineStage.id,
      pipelineId: pipeline.id,
      assignedTo: staff[i % staff.length].id,
      source: sources[i % sources.length],
      tags: [tagsList[i % tagsList.length], tagsList[(i + 3) % tagsList.length]].filter((v, idx, a) => a.indexOf(v) === idx),
      score: Math.floor(Math.random() * 100),
      dealValue: (Math.floor(Math.random() * 50) + 1) * 10000,
      createdAt: subDays(new Date(), Math.floor(Math.random() * 30)).toISOString(),
      lastActivity: subHours(new Date(), Math.floor(Math.random() * 48)).toISOString(),
      notes: [],
    });
  }
  return result;
}

export const leads: Lead[] = generateLeads();

export const conversations: Conversation[] = [
  {
    id: 'conv-1', leadId: 'lead-1', leadName: 'Ranjith Kumar', leadPhone: '+91 9000000000', channel: 'whatsapp',
    lastMessage: 'Sure, I\'ll check the proposal and get back to you by tomorrow.', lastMessageTime: subMinutes(new Date(), 5).toISOString(),
    unreadCount: 2, status: 'open', assignedTo: 's1',
    messages: [
      { id: 'm1', text: 'Hi, I saw your ad on Facebook. I\'m interested in learning more about your services.', sender: 'customer', timestamp: subHours(new Date(), 3).toISOString() },
      { id: 'm2', text: 'Hello Ranjith! Thanks for reaching out. We\'d love to help. What specific services are you looking for?', sender: 'agent', timestamp: subHours(new Date(), 2.5).toISOString(), status: 'read' },
      { id: 'm3', text: 'I need a CRM solution for my bakery business. We have about 200 customers.', sender: 'customer', timestamp: subHours(new Date(), 2).toISOString() },
      { id: 'm4', text: 'Perfect! Our SMB plan would be ideal for you. Let me send you a proposal with pricing details.', sender: 'agent', timestamp: subHours(new Date(), 1.5).toISOString(), status: 'read' },
      { id: 'm5', text: 'Sure, I\'ll check the proposal and get back to you by tomorrow.', sender: 'customer', timestamp: subMinutes(new Date(), 5).toISOString() },
    ],
  },
  {
    id: 'conv-2', leadId: 'lead-2', leadName: 'Priya Sharma', leadPhone: '+91 9000001111', channel: 'whatsapp',
    lastMessage: 'Can we schedule a demo for next week?', lastMessageTime: subMinutes(new Date(), 20).toISOString(),
    unreadCount: 1, status: 'open', assignedTo: 's2',
    messages: [
      { id: 'm6', text: 'Hi, we need enterprise CRM for our tech company.', sender: 'customer', timestamp: subHours(new Date(), 5).toISOString() },
      { id: 'm7', text: 'Hi Priya! We have excellent enterprise plans. How many team members do you have?', sender: 'agent', timestamp: subHours(new Date(), 4).toISOString(), status: 'read' },
      { id: 'm8', text: 'About 50 people across 3 departments.', sender: 'customer', timestamp: subHours(new Date(), 3).toISOString() },
      { id: 'm9', text: 'Can we schedule a demo for next week?', sender: 'customer', timestamp: subMinutes(new Date(), 20).toISOString() },
    ],
  },
  {
    id: 'conv-3', leadId: 'lead-3', leadName: 'Amit Patel', leadPhone: '+91 9000002222', channel: 'whatsapp',
    lastMessage: 'Thank you for the quick response!', lastMessageTime: subHours(new Date(), 1).toISOString(),
    unreadCount: 0, status: 'resolved', assignedTo: 's3',
    messages: [
      { id: 'm10', text: 'Is there a free trial available?', sender: 'customer', timestamp: subHours(new Date(), 6).toISOString() },
      { id: 'm11', text: 'Yes! We offer a 14-day free trial with full features. Want me to set one up?', sender: 'agent', timestamp: subHours(new Date(), 5).toISOString(), status: 'read' },
      { id: 'm12', text: 'Thank you for the quick response!', sender: 'customer', timestamp: subHours(new Date(), 1).toISOString() },
    ],
  },
  {
    id: 'conv-4', leadId: 'lead-6', leadName: 'Ananya Nair', leadPhone: '+91 9000005555', channel: 'whatsapp',
    lastMessage: 'I\'ll discuss with my team and revert.', lastMessageTime: subHours(new Date(), 4).toISOString(),
    unreadCount: 0, status: 'pending', assignedTo: 's5',
    messages: [
      { id: 'm13', text: 'We are evaluating CRM tools for our organic food delivery service.', sender: 'customer', timestamp: subDays(new Date(), 1).toISOString() },
      { id: 'm14', text: 'Great! NexCRM is perfect for delivery businesses. We have route optimization and customer tracking built in.', sender: 'agent', timestamp: subDays(new Date(), 1).toISOString(), status: 'delivered' },
      { id: 'm15', text: 'I\'ll discuss with my team and revert.', sender: 'customer', timestamp: subHours(new Date(), 4).toISOString() },
    ],
  },
  {
    id: 'conv-5', leadId: 'lead-8', leadName: 'Deepa Joshi', leadPhone: '+91 9000007777', channel: 'whatsapp',
    lastMessage: 'Sent the contract via email. Please review.', lastMessageTime: subHours(new Date(), 2).toISOString(),
    unreadCount: 0, status: 'open', assignedTo: 's1',
    messages: [
      { id: 'm16', text: 'Ready to move forward with the annual plan.', sender: 'customer', timestamp: subHours(new Date(), 8).toISOString() },
      { id: 'm17', text: 'Excellent! I\'ll prepare the contract right away.', sender: 'agent', timestamp: subHours(new Date(), 7).toISOString(), status: 'read' },
      { id: 'm18', text: 'Sent the contract via email. Please review.', sender: 'agent', timestamp: subHours(new Date(), 2).toISOString(), status: 'delivered' },
    ],
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `conv-${i + 6}`,
    leadId: `lead-${i + 10}`,
    leadName: `${firstNames[(i + 10) % firstNames.length]} ${lastNames[(i + 10) % lastNames.length]}`,
    leadPhone: `+91 ${9000000000 + (i + 10) * 1111}`,
    channel: 'whatsapp' as const,
    lastMessage: ['Looking forward to the demo', 'Can you share pricing?', 'Thanks for the info', 'When can we start?', 'Need more details', 'Let me think about it', 'Sounds interesting'][i],
    lastMessageTime: subHours(new Date(), i + 5).toISOString(),
    unreadCount: i < 3 ? 1 : 0,
    status: (['open', 'pending', 'open', 'resolved', 'open', 'pending', 'open'] as const)[i],
    assignedTo: staff[i % staff.length].id,
    messages: [
      { id: `mx-${i}-1`, text: 'Hi, interested in your product.', sender: 'customer' as const, timestamp: subHours(new Date(), i + 10).toISOString() },
      { id: `mx-${i}-2`, text: 'Thanks for reaching out! How can I help?', sender: 'agent' as const, timestamp: subHours(new Date(), i + 8).toISOString(), status: 'read' as const },
    ],
  })),
];

export const workflows: Workflow[] = [
  { id: 'wf-1', name: 'New Lead Welcome', trigger: 'Lead Created', status: 'active', executions: 342, lastRun: subHours(new Date(), 1).toISOString(), actions: ['Send WhatsApp', 'Add Tag', 'Assign Staff'] },
  { id: 'wf-2', name: 'Follow-up Reminder', trigger: 'Follow-up Due', status: 'active', executions: 156, lastRun: subHours(new Date(), 3).toISOString(), actions: ['Internal Notification', 'Send Email'] },
  { id: 'wf-3', name: 'Stage Change Notification', trigger: 'Stage Changed', status: 'active', executions: 89, lastRun: subHours(new Date(), 2).toISOString(), actions: ['Send WhatsApp', 'Update Field'] },
  { id: 'wf-4', name: 'Appointment Booked Auto-reply', trigger: 'Appointment Booked', status: 'inactive', executions: 67, lastRun: subDays(new Date(), 2).toISOString(), actions: ['Send WhatsApp', 'Create Follow-up'] },
  { id: 'wf-5', name: 'Inactive Lead Nurture', trigger: 'Field Updated', status: 'active', executions: 142, lastRun: subHours(new Date(), 5).toISOString(), actions: ['Delay', 'Send Email', 'Move Stage'] },
];

export const calendarEvents: CalendarEvent[] = [
  { id: 'evt-1', title: 'Demo Call - Saral Bakery', type: 'demo', leadName: 'Ranjith Kumar', assignedTo: 's1', date: format(new Date(), 'yyyy-MM-dd'), time: '10:00', duration: 30, status: 'scheduled', meetingLink: 'https://meet.google.com/abc-def-ghi' },
  { id: 'evt-2', title: 'Follow-up Call', type: 'call', leadName: 'Priya Sharma', assignedTo: 's2', date: format(new Date(), 'yyyy-MM-dd'), time: '14:00', duration: 15, status: 'scheduled' },
  { id: 'evt-3', title: 'Contract Discussion', type: 'meeting', leadName: 'Amit Patel', assignedTo: 's3', date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), time: '11:00', duration: 45, status: 'scheduled', meetingLink: 'https://zoom.us/j/123456' },
  { id: 'evt-4', title: 'Product Walkthrough', type: 'demo', leadName: 'Sara Reddy', assignedTo: 's1', date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), time: '16:00', duration: 60, status: 'scheduled' },
  { id: 'evt-5', title: 'Onboarding Call', type: 'call', leadName: 'Vikram Singh', assignedTo: 's5', date: format(addDays(new Date(), 2), 'yyyy-MM-dd'), time: '09:30', duration: 30, status: 'scheduled' },
  { id: 'evt-6', title: 'Quarterly Review', type: 'meeting', leadName: 'Ananya Nair', assignedTo: 's4', date: format(subDays(new Date(), 1), 'yyyy-MM-dd'), time: '15:00', duration: 45, status: 'completed' },
  { id: 'evt-7', title: 'Discovery Call', type: 'call', leadName: 'Karthik Gupta', assignedTo: 's6', date: format(subDays(new Date(), 2), 'yyyy-MM-dd'), time: '10:30', duration: 20, status: 'no-show' },
  { id: 'evt-8', title: 'Pricing Discussion', type: 'meeting', leadName: 'Deepa Joshi', assignedTo: 's1', date: format(addDays(new Date(), 3), 'yyyy-MM-dd'), time: '13:00', duration: 30, status: 'scheduled' },
  { id: 'evt-9', title: 'Technical Demo', type: 'demo', leadName: 'Suresh Menon', assignedTo: 's3', date: format(addDays(new Date(), 4), 'yyyy-MM-dd'), time: '11:00', duration: 60, status: 'scheduled' },
  { id: 'evt-10', title: 'Check-in Call', type: 'call', leadName: 'Meera Das', assignedTo: 's5', date: format(addDays(new Date(), 5), 'yyyy-MM-dd'), time: '14:30', duration: 15, status: 'scheduled' },
  { id: 'evt-11', title: 'Strategy Session', type: 'meeting', leadName: 'Rohit Verma', assignedTo: 's1', date: format(new Date(), 'yyyy-MM-dd'), time: '08:30', duration: 45, status: 'scheduled', meetingLink: 'https://meet.google.com/xyz-abc' },
  { id: 'evt-12', title: 'Sales Pipeline Review', type: 'meeting', leadName: 'Kavitha Rao', assignedTo: 's2', date: format(new Date(), 'yyyy-MM-dd'), time: '09:00', duration: 30, status: 'scheduled' },
  { id: 'evt-13', title: 'Product Demo - TechCorp', type: 'demo', leadName: 'Arun Nair', assignedTo: 's3', date: format(new Date(), 'yyyy-MM-dd'), time: '11:00', duration: 60, status: 'scheduled', meetingLink: 'https://zoom.us/j/789012' },
  { id: 'evt-14', title: 'Client Onboarding', type: 'call', leadName: 'Neha Gupta', assignedTo: 's4', date: format(new Date(), 'yyyy-MM-dd'), time: '11:30', duration: 30, status: 'scheduled' },
  { id: 'evt-15', title: 'Proposal Walkthrough', type: 'demo', leadName: 'Sanjay Iyer', assignedTo: 's1', date: format(new Date(), 'yyyy-MM-dd'), time: '12:00', duration: 45, status: 'scheduled', meetingLink: 'https://meet.google.com/def-ghi' },
  { id: 'evt-16', title: 'Support Escalation', type: 'call', leadName: 'Lakshmi Bhat', assignedTo: 's5', date: format(new Date(), 'yyyy-MM-dd'), time: '13:00', duration: 20, status: 'scheduled' },
  { id: 'evt-17', title: 'Partnership Discussion', type: 'meeting', leadName: 'Vivek Reddy', assignedTo: 's2', date: format(new Date(), 'yyyy-MM-dd'), time: '15:00', duration: 30, status: 'scheduled', meetingLink: 'https://meet.google.com/jkl-mno' },
  { id: 'evt-18', title: 'Feature Demo - SmartRetail', type: 'demo', leadName: 'Divya Krishnan', assignedTo: 's3', date: format(new Date(), 'yyyy-MM-dd'), time: '15:30', duration: 45, status: 'scheduled' },
  { id: 'evt-19', title: 'Renewal Call', type: 'call', leadName: 'Harish Kumar', assignedTo: 's4', date: format(new Date(), 'yyyy-MM-dd'), time: '16:30', duration: 15, status: 'scheduled' },
  { id: 'evt-20', title: 'End-of-Day Sync', type: 'meeting', leadName: 'Pooja Mehta', assignedTo: 's1', date: format(new Date(), 'yyyy-MM-dd'), time: '17:00', duration: 30, status: 'scheduled' },
];

// ─── Extended Types ───────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface Opportunity {
  id: string;
  leadId: string;
  title: string;
  value: number;
  status: 'open' | 'won' | 'lost';
  probability: number;
  expectedCloseDate: string;
  lostReason?: string;
  assignedTo: string;
  createdAt: string;
}

export interface NoteEntry {
  id: string;
  leadId: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

export interface FollowUp {
  id: string;
  leadId: string;
  dueAt: string;
  note: string;
  completed: boolean;
  assignedTo?: string;
  createdAt?: string;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  slug: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'dropdown' | 'email' | 'phone' | 'url' | 'file' | 'checkbox';
  required: boolean;
  visible: boolean;
  options?: string[];
  orderIndex: number;
}

export interface BookingLink {
  id: string;
  title: string;
  eventType: string;
  duration: number;
  buffer: number;
  description: string;
  assignedTo: string;
  slug: string;
  isActive: boolean;
  meetingsCount: number;
}

export interface AvailabilitySlot {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface QuickReply {
  id: string;
  title: string;
  content: string;
}

// ─── Extended Mock Data ───────────────────────────────────────────────────────

export const tags: Tag[] = [
  { id: 't1', name: 'Hot Lead', color: '#ef4444', count: 12 },
  { id: 't2', name: 'Enterprise', color: '#8b5cf6', count: 8 },
  { id: 't3', name: 'SMB', color: '#3b82f6', count: 15 },
  { id: 't4', name: 'Follow Up', color: '#eab308', count: 20 },
  { id: 't5', name: 'Demo Scheduled', color: '#22c55e', count: 6 },
  { id: 't6', name: 'Price Sent', color: '#f97316', count: 9 },
  { id: 't7', name: 'Urgent', color: '#dc2626', count: 4 },
  { id: 't8', name: 'VIP', color: '#d97706', count: 3 },
];

export const opportunities: Opportunity[] = [
  { id: 'opp-1', leadId: 'lead-1', title: 'Saral Bakery CRM Plan', value: 250000, status: 'open', probability: 70, expectedCloseDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'), assignedTo: 's1', createdAt: subDays(new Date(), 5).toISOString() },
  { id: 'opp-2', leadId: 'lead-2', title: 'TechWave Enterprise License', value: 1200000, status: 'open', probability: 55, expectedCloseDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'), assignedTo: 's2', createdAt: subDays(new Date(), 10).toISOString() },
  { id: 'opp-3', leadId: 'lead-3', title: 'GreenLeaf Starter Pack', value: 85000, status: 'won', probability: 100, expectedCloseDate: format(subDays(new Date(), 2), 'yyyy-MM-dd'), assignedTo: 's3', createdAt: subDays(new Date(), 20).toISOString() },
];

export const notes: NoteEntry[] = [
  { id: 'note-1', leadId: 'lead-1', content: 'Very interested in the bakery plan. Called twice to confirm pricing.', createdBy: 's1', createdAt: subHours(new Date(), 6).toISOString() },
  { id: 'note-2', leadId: 'lead-2', content: 'Requested a full enterprise demo with IT team present.', createdBy: 's2', createdAt: subDays(new Date(), 1).toISOString() },
];

export const followUps: FollowUp[] = [
  { id: 'fu-1', leadId: 'lead-1', dueAt: addHours(new Date(), 2).toISOString(), note: 'Call back\nPre sales pitch', completed: false, assignedTo: 's1', createdAt: subDays(new Date(), 1).toISOString() },
  { id: 'fu-2', leadId: 'lead-2', dueAt: addDays(new Date(), 1).toISOString(), note: 'Schedule demo call with tech team', completed: false, assignedTo: 's2', createdAt: subDays(new Date(), 2).toISOString() },
  { id: 'fu-3', leadId: 'lead-3', dueAt: subHours(new Date(), 1).toISOString(), note: 'Send contract for signature', completed: true, assignedTo: 's3', createdAt: subDays(new Date(), 3).toISOString() },
  { id: 'fu-4', leadId: 'lead-4', dueAt: subDays(new Date(), 2).toISOString(), note: 'Pre sales Pitch', completed: false, assignedTo: 's1', createdAt: subDays(new Date(), 4).toISOString() },
  { id: 'fu-5', leadId: 'lead-5', dueAt: addDays(new Date(), 3).toISOString(), note: 'Sales Followup\nAsked to call after 2 days', completed: true, assignedTo: 's2', createdAt: subDays(new Date(), 1).toISOString() },
  { id: 'fu-6', leadId: 'lead-6', dueAt: addHours(new Date(), 5).toISOString(), note: 'Send pricing deck', completed: false, assignedTo: 's3', createdAt: subDays(new Date(), 1).toISOString() },
];

export const customFields: CustomFieldDef[] = [
  { id: 'cf1', name: 'Company Name', slug: 'company_name', type: 'text', required: true, visible: true, orderIndex: 0 },
  { id: 'cf2', name: 'Industry', slug: 'industry', type: 'dropdown', required: false, visible: true, options: ['Technology', 'Retail', 'Food & Beverage', 'Real Estate', 'Healthcare', 'Finance', 'Other'], orderIndex: 1 },
  { id: 'cf3', name: 'Annual Revenue', slug: 'annual_revenue', type: 'number', required: false, visible: false, orderIndex: 2 },
  { id: 'cf4', name: 'Website', slug: 'website', type: 'url', required: false, visible: true, orderIndex: 3 },
  { id: 'cf5', name: 'Follow-up Date', slug: 'followup_date', type: 'date', required: false, visible: true, orderIndex: 4 },
  { id: 'cf6', name: 'Proposal File', slug: 'proposal_file', type: 'file', required: false, visible: false, orderIndex: 5 },
];

export const bookingLinks: BookingLink[] = [
  { id: 'bl-1', title: '30-min Demo', eventType: 'demo', duration: 30, buffer: 10, description: 'Product demonstration call', assignedTo: 's1', slug: 'ranjith-30min-demo', isActive: true, meetingsCount: 24 },
  { id: 'bl-2', title: '1-hr Consultation', eventType: 'meeting', duration: 60, buffer: 15, description: 'In-depth business consultation', assignedTo: 's2', slug: 'priya-1hr-consult', isActive: true, meetingsCount: 12 },
  { id: 'bl-3', title: '15-min Intro Call', eventType: 'call', duration: 15, buffer: 5, description: 'Quick introductory call', assignedTo: 's5', slug: 'vikram-intro-call', isActive: false, meetingsCount: 8 },
];

export const availabilitySlots: AvailabilitySlot[] = [
  ...['s1', 's2', 's3'].flatMap((userId) =>
    [1, 2, 3, 4, 5].map((day) => ({
      id: `avail-${userId}-${day}`,
      userId,
      dayOfWeek: day,
      startTime: '09:00',
      endTime: '18:00',
      isActive: true,
    }))
  ),
];

export const quickReplies: QuickReply[] = [
  { id: 'qr-1', title: 'Greeting', content: 'Hi {%first_name%}! Thanks for reaching out to us. How can I help you today?' },
  { id: 'qr-2', title: 'Send Pricing', content: 'Hi {%first_name%}, I\'ll send you our pricing details shortly. Can you share your team size?' },
  { id: 'qr-3', title: 'Schedule Demo', content: 'Hi {%first_name%}, I\'d love to show you a demo! Here\'s my booking link: {%booking_link%}' },
  { id: 'qr-4', title: 'Follow Up', content: 'Hi {%first_name%}, just following up on our last conversation. Have you had a chance to review?' },
  { id: 'qr-5', title: 'Thank You', content: 'Thank you {%first_name%}! It was great speaking with you. I\'ll send the details over email.' },
];

export const notifications: Notification[] = [
  { id: 'n1', type: 'lead_created', message: 'New lead Ranjith Kumar from Meta Forms', time: subMinutes(new Date(), 5).toISOString(), read: false, avatar: 'RK' },
  { id: 'n2', type: 'stage_changed', message: 'Priya Sharma moved to Qualified', time: subMinutes(new Date(), 15).toISOString(), read: false, avatar: 'PS' },
  { id: 'n3', type: 'new_message', message: 'New WhatsApp message from Amit Patel', time: subMinutes(new Date(), 30).toISOString(), read: false, avatar: 'AP' },
  { id: 'n4', type: 'follow_up_due', message: 'Follow-up due: Sara Reddy in 30 mins', time: subHours(new Date(), 1).toISOString(), read: true, avatar: 'SR' },
  { id: 'n5', type: 'appointment', message: 'Upcoming demo with Vikram Singh at 3 PM', time: subHours(new Date(), 2).toISOString(), read: true, avatar: 'VS' },
  { id: 'n6', type: 'lead_created', message: 'New lead Ananya Nair from WhatsApp', time: subHours(new Date(), 3).toISOString(), read: true, avatar: 'AN' },
  { id: 'n7', type: 'stage_changed', message: 'Karthik Gupta moved to Closed Won', time: subHours(new Date(), 4).toISOString(), read: true, avatar: 'KG' },
  { id: 'n8', type: 'new_message', message: '3 unread messages from Deepa Joshi', time: subHours(new Date(), 5).toISOString(), read: true, avatar: 'DJ' },
  { id: 'n9', type: 'follow_up_due', message: 'Follow-up overdue: Suresh Menon', time: subHours(new Date(), 8).toISOString(), read: true, avatar: 'SM' },
  { id: 'n10', type: 'appointment', message: 'Meeting completed: Meera Das', time: subHours(new Date(), 10).toISOString(), read: true, avatar: 'MD' },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `n${i + 11}`,
    type: (['lead_created', 'stage_changed', 'new_message', 'follow_up_due', 'appointment'] as const)[i % 5],
    message: `Notification ${i + 11}: Activity update for lead ${firstNames[i % firstNames.length]}`,
    time: subHours(new Date(), 12 + i).toISOString(),
    read: true,
    avatar: `${firstNames[i % firstNames.length][0]}${lastNames[i % lastNames.length][0]}`,
  })),
];
