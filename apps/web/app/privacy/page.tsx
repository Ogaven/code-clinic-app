import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | Code Clinic',
  description: 'Privacy Policy for Code Clinic Dental Management System',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFF] dark:bg-[#0A0F1E]">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1A237E] to-[#0D47A1]">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link href="/login">
            <Image
              src="/logo.png"
              alt="Code Clinic"
              width={160}
              height={54}
              className="h-12 w-auto"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Link>
          <Link
            href="/terms"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            Terms of Service →
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Title block */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 bg-[#EBF0FF] dark:bg-[#1A2744] text-[#1A237E] dark:text-[#29ABE2] text-xs font-semibold px-3 py-1.5 rounded-full mb-4 uppercase tracking-wide">
            Legal
          </div>
          <h1 className="text-3xl font-bold text-[#1A237E] dark:text-white mb-3">
            Privacy Policy
          </h1>
          <p className="text-[#64748B] dark:text-[#94A3B8] text-sm">
            Last updated: 17 May 2026 &nbsp;·&nbsp; Code Clinic Dental Clinic, Kamwokya, Kampala, Uganda
          </p>
        </div>

        <div className="space-y-8 text-[#334155] dark:text-[#CBD5E1] leading-relaxed">

          {/* Intro */}
          <Section>
            <p>
              Code Clinic Dental Clinic ("we", "our", or "us") operates the Code Clinic dental
              management platform accessible at <strong>codeclinicemr.com</strong>. This Privacy Policy
              explains how we collect, use, store, and protect the personal and medical information
              of patients, staff, and other users of our system.
            </p>
            <p className="mt-3">
              By using the Code Clinic platform, you agree to the practices described in this policy.
              If you do not agree, please discontinue use and contact us at{' '}
              <a href="mailto:codeclinic24@gmail.com" className="text-[#29ABE2] hover:underline">
                codeclinic24@gmail.com
              </a>.
            </p>
          </Section>

          {/* 1 */}
          <Section title="1. Information We Collect">
            <p>We collect the following categories of information:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li><strong>Patient information:</strong> Full name, date of birth, gender, contact number, address, next-of-kin details.</Li>
              <Li><strong>Medical &amp; dental records:</strong> Diagnosis history, treatment plans, prescriptions, dental charts, X-ray references, clinical notes, and visit summaries.</Li>
              <Li><strong>Appointment data:</strong> Booking dates and times, assigned doctor, service type, appointment status, and attendance history.</Li>
              <Li><strong>Account credentials:</strong> Email address and hashed passwords for staff accounts. Patients do not create login accounts.</Li>
              <Li><strong>Usage data:</strong> IP address, browser type, pages visited, and timestamps — collected automatically for security and system monitoring.</Li>
            </ul>
          </Section>

          {/* 2 */}
          <Section title="2. How We Use Your Information">
            <p>We use the information collected solely for the following purposes:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li>Delivering and managing clinical care and appointment scheduling.</Li>
              <Li>Sending appointment reminders and health communications via WhatsApp and SMS.</Li>
              <Li>Syncing appointments to staff calendars via Google Calendar integration.</Li>
              <Li>Generating internal clinical reports for administrative and billing purposes.</Li>
              <Li>Improving the security, reliability, and functionality of the platform.</Li>
              <Li>Complying with applicable Ugandan health and data protection regulations.</Li>
            </ul>
            <p className="mt-3">
              We do not sell, rent, or share patient data with third parties for marketing purposes.
            </p>
          </Section>

          {/* 3 */}
          <Section title="3. Data Storage &amp; Security">
            <p>
              All data is stored on secure servers operated by{' '}
              <strong>DigitalOcean LLC</strong>, located in <strong>Frankfurt, Germany</strong>,
              within the European Union. DigitalOcean maintains ISO 27001-certified data centres
              with physical and logical security controls.
            </p>
            <p className="mt-3">We protect your data through:</p>
            <ul className="mt-2 space-y-2 list-none">
              <Li>Encrypted connections (HTTPS/TLS) for all data in transit.</Li>
              <Li>Database access restricted to authorised application services only.</Li>
              <Li>Role-based access controls — staff can only access data relevant to their role.</Li>
              <Li>Regular backups to prevent data loss.</Li>
              <Li>Passwords stored using strong one-way hashing (bcrypt).</Li>
            </ul>
          </Section>

          {/* 4 */}
          <Section title="4. Third-Party Services">
            <p>We integrate with the following third-party services to deliver core functionality:</p>
            <div className="mt-4 space-y-4">
              <ThirdParty name="Google Calendar" purpose="Used by clinic staff to sync appointment schedules. Only appointment title, date, time, and assigned doctor are shared. Google's privacy policy applies." />
              <ThirdParty name="WhatsApp (Meta)" purpose="Used to send appointment confirmations, reminders, and follow-up messages to patients using their registered phone numbers. Messages are sent via WhatsApp Business API." />
              <ThirdParty name="Africa's Talking" purpose="Used to send SMS appointment reminders to patients without WhatsApp. Only the patient's phone number and message content are shared." />
              <ThirdParty name="Cloudflare R2" purpose="Used for secure storage of audio recordings from voice-assisted clinical notes. Recordings are encrypted at rest and accessible only to authorised staff." />
            </div>
            <p className="mt-4">
              Each third-party provider operates under its own privacy policy. We do not permit these
              providers to use your data for any purpose other than delivering the service.
            </p>
          </Section>

          {/* 5 */}
          <Section title="5. Data Retention">
            <p>
              Patient medical records are retained in accordance with Ugandan health regulations.
              Clinical records are kept for a minimum of <strong>10 years</strong> from the date of last
              treatment. Staff account data is retained for as long as the account remains active,
              plus 12 months after deactivation for audit purposes.
            </p>
            <p className="mt-3">
              Appointment reminder messages and system logs are retained for up to <strong>12 months</strong>.
            </p>
          </Section>

          {/* 6 */}
          <Section title="6. Patient Rights">
            <p>As a patient, you have the right to:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li><strong>Access</strong> — request a copy of the personal and medical data we hold about you.</Li>
              <Li><strong>Correction</strong> — request that inaccurate or incomplete data be corrected.</Li>
              <Li><strong>Deletion</strong> — request deletion of your data, subject to legal retention requirements.</Li>
              <Li><strong>Objection</strong> — object to specific uses of your data, such as WhatsApp communications.</Li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:codeclinic24@gmail.com" className="text-[#29ABE2] hover:underline">
                codeclinic24@gmail.com
              </a>. We will respond within 14 days.
            </p>
          </Section>

          {/* 7 */}
          <Section title="7. Cookies &amp; Local Storage">
            <p>
              The Code Clinic web application uses browser <strong>local storage</strong> (not cookies)
              to remember your theme preference (light or dark mode) and keep you logged in during
              your session via a secure authentication token. No tracking or advertising cookies
              are used.
            </p>
          </Section>

          {/* 8 */}
          <Section title="8. Children's Privacy">
            <p>
              Our clinic treats patients of all ages, including minors. Records for patients under 18
              are created and managed by authorised clinic staff on behalf of the patient's guardian.
              We do not knowingly collect information directly from children.
            </p>
          </Section>

          {/* 9 */}
          <Section title="9. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will revise the
              "Last updated" date at the top of this page. Continued use of the platform after any
              changes constitutes acceptance of the updated policy.
            </p>
          </Section>

          {/* 10 */}
          <Section title="10. Contact Us">
            <p>
              For any privacy-related questions, requests, or concerns, please contact:
            </p>
            <div className="mt-4 p-4 rounded-xl bg-[#EBF0FF] dark:bg-[#1A2744] space-y-1 text-sm">
              <p className="font-semibold text-[#1A237E] dark:text-[#29ABE2]">Code Clinic Dental Clinic</p>
              <p>Kamwokya, Kampala, Uganda</p>
              <p>
                Email:{' '}
                <a href="mailto:codeclinic24@gmail.com" className="text-[#29ABE2] hover:underline">
                  codeclinic24@gmail.com
                </a>
              </p>
            </div>
          </Section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E2E8F0] dark:border-[#1A2744] mt-16">
        <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[#94A3B8]">
          <span>© 2026 Code Clinic Dental Clinic. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-[#1A237E] dark:text-[#29ABE2] font-medium">Privacy Policy</Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-[#1A237E] dark:hover:text-[#29ABE2] transition-colors">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-[#0D1B2A] rounded-2xl p-6 shadow-sm border border-[#E2E8F0] dark:border-[#1A2744]">
      {title && (
        <h2 className="text-base font-semibold text-[#1A237E] dark:text-[#29ABE2] mb-3">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#29ABE2] shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function ThirdParty({ name, purpose }: { name: string; purpose: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-[#1A237E] dark:bg-[#29ABE2] shrink-0" />
      <div>
        <span className="font-semibold text-[#1A237E] dark:text-white">{name}:</span>{' '}
        <span>{purpose}</span>
      </div>
    </div>
  );
}
