// Shared system field definitions — single source of truth used by
// FieldsPage and the webhook Custom Values modal (and anywhere else).
// These are system-defined fields; user-created custom fields come from /api/fields/custom.

export interface SystemField {
  id: string;
  name: string;
  slug: string;       // e.g. "contact.first_name"
  group: string;      // "Contact" | "Company" | "Calendar"
  isSystem: true;
}

export const SYSTEM_STANDARD_FIELDS: SystemField[] = [
  // Contact
  { id: 'c00', name: 'Full Name',           slug: 'contact.full_name',          group: 'Contact', isSystem: true },
  { id: 'c01', name: 'First Name',          slug: 'contact.first_name',         group: 'Contact', isSystem: true },
  { id: 'c02', name: 'Last Name',           slug: 'contact.last_name',          group: 'Contact', isSystem: true },
  { id: 'c03', name: 'Email',               slug: 'contact.email',              group: 'Contact', isSystem: true },
  { id: 'c04', name: 'Phone',               slug: 'contact.phone',              group: 'Contact', isSystem: true },
  { id: 'c05', name: 'Contact Source',      slug: 'contact.contact_source',     group: 'Contact', isSystem: true },
  { id: 'c06', name: 'Opportunity Name',    slug: 'contact.opportunity_name',   group: 'Contact', isSystem: true },
  { id: 'c07', name: 'Lead Value',          slug: 'contact.lead_value',         group: 'Contact', isSystem: true },
  { id: 'c08', name: 'Assigned to Staff',   slug: 'contact.assigned_to_staff',  group: 'Contact', isSystem: true },
  { id: 'c09', name: 'Opportunity Source',  slug: 'contact.opportunity_source', group: 'Contact', isSystem: true },
  { id: 'c10', name: 'Contact Type',        slug: 'contact.contact_type',       group: 'Contact', isSystem: true },
  { id: 'c11', name: 'Business Name',       slug: 'contact.business_name',      group: 'Contact', isSystem: true },
  { id: 'c12', name: 'Business GST No',     slug: 'contact.gst_no',             group: 'Contact', isSystem: true },
  { id: 'c13', name: 'Business State',      slug: 'contact.state',              group: 'Contact', isSystem: true },
  { id: 'c14', name: 'Business Address',    slug: 'contact.street_address',     group: 'Contact', isSystem: true },
  { id: 'c15', name: 'Profile Photo',       slug: 'contact.profile_image',      group: 'Contact', isSystem: true },
  { id: 'c16', name: 'Date of Birth',       slug: 'contact.date_of_birth',      group: 'Contact', isSystem: true },
  { id: 'c17', name: 'Postal Code',         slug: 'contact.postal_code',        group: 'Contact', isSystem: true },
  // Company
  { id: 'co1', name: 'Company Name',        slug: 'company.name',               group: 'Company', isSystem: true },
  { id: 'co2', name: 'Company Email',       slug: 'company.email',              group: 'Company', isSystem: true },
  { id: 'co3', name: 'Company Phone',       slug: 'company.phone',              group: 'Company', isSystem: true },
  { id: 'co4', name: 'Company Address',     slug: 'company.address',            group: 'Company', isSystem: true },
  { id: 'co5', name: 'Company GST No.',     slug: 'company.gst_no',             group: 'Company', isSystem: true },
  { id: 'co6', name: 'Company Logo',        slug: 'company.logo',               group: 'Company', isSystem: true },
  { id: 'co7', name: 'Leader Name',         slug: 'company.leader_name',        group: 'Company', isSystem: true },
  { id: 'co8', name: 'Leader Designation',  slug: 'company.leader_designation', group: 'Company', isSystem: true },
  { id: 'co9', name: 'Leader Image',        slug: 'company.leader_image',       group: 'Company', isSystem: true },
  // Calendar
  { id: 'cal1', name: 'Appointment Date',       slug: 'calendar.appointment_date',        group: 'Calendar', isSystem: true },
  { id: 'cal2', name: 'Appointment Start Time', slug: 'calendar.appointment_start_time',  group: 'Calendar', isSystem: true },
  { id: 'cal3', name: 'Appointment End Time',   slug: 'calendar.appointment_end_time',    group: 'Calendar', isSystem: true },
  { id: 'cal4', name: 'Appointment Timezone',   slug: 'calendar.appointment_timezone',    group: 'Calendar', isSystem: true },
];

export const SYSTEM_GROUPS = ['Contact', 'Company', 'Calendar'] as const;

/** Returns the variable string for a slug, e.g. "contact.first_name" → "{%contact.first_name%}" */
export const slugToVar = (slug: string) => `{%${slug}%}`;
