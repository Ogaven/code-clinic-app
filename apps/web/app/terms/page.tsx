import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service | Code Clinic',
  description: 'Terms of Service for Code Clinic Dental Management System',
};

export default function TermsPage() {
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
            href="/privacy"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            ← Privacy Policy
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
            Terms of Service
          </h1>
          <p className="text-[#64748B] dark:text-[#94A3B8] text-sm">
            Last updated: 17 May 2026 &nbsp;·&nbsp; Code Clinic Dental Clinic, Kamwokya, Kampala, Uganda
          </p>
        </div>

        <div className="space-y-8 text-[#334155] dark:text-[#CBD5E1] leading-relaxed">

          {/* Intro */}
          <Section>
            <p>
              These Terms of Service ("Terms") govern your access to and use of the Code Clinic dental
              management platform ("the Platform") operated by <strong>Code Clinic Dental Clinic</strong>,
              located in Kamwokya, Kampala, Uganda. By accessing or using the Platform, you agree to
              be bound by these Terms.
            </p>
            <p className="mt-3">
              If you do not agree to these Terms, you must not use the Platform. For questions, contact
              us at{' '}
              <a href="mailto:codeclinic24@gmail.com" className="text-[#29ABE2] hover:underline">
                codeclinic24@gmail.com
              </a>.
            </p>
          </Section>

          {/* 1 */}
          <Section title="1. Who May Use the Platform">
            <p>The Code Clinic platform is a <strong>closed clinical management system</strong> intended exclusively for:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li>Authorised staff of Code Clinic Dental Clinic (doctors, receptionists, administrators).</Li>
              <Li>Patients whose records are managed by clinic staff on their behalf.</Li>
            </ul>
            <p className="mt-3">
              Access is granted by clinic administrators only. Unauthorised access, account sharing, or
              use of the Platform for any purpose outside clinical management is strictly prohibited.
            </p>
          </Section>

          {/* 2 */}
          <Section title="2. Account Responsibilities">
            <p>If you have been issued a staff account, you agree to:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li>Keep your login credentials confidential and not share them with any other person.</Li>
              <Li>Log out of your account when leaving an unattended device.</Li>
              <Li>Notify the clinic administrator immediately if you suspect unauthorised access to your account.</Li>
              <Li>Use the Platform only for legitimate clinical duties within the scope of your role.</Li>
              <Li>Access only patient records that are relevant to your assigned duties.</Li>
            </ul>
            <p className="mt-3">
              You are responsible for all activity that occurs under your account.
            </p>
          </Section>

          {/* 3 */}
          <Section title="3. Acceptable Use">
            <p>You agree not to use the Platform to:</p>
            <ul className="mt-3 space-y-2 list-none">
              <Li>Access, copy, or disclose patient records without clinical justification.</Li>
              <Li>Upload, store, or transmit any unlawful, harmful, or offensive content.</Li>
              <Li>Attempt to probe, scan, or test the vulnerability of the system.</Li>
              <Li>Interfere with the security, integrity, or performance of the Platform.</Li>
              <Li>Circumvent any authentication or access control mechanism.</Li>
              <Li>Use the Platform for any commercial purpose unrelated to clinic operations.</Li>
            </ul>
            <p className="mt-3">
              Violations may result in immediate account suspension and, where applicable, referral to
              relevant authorities under Ugandan law.
            </p>
          </Section>

          {/* 4 */}
          <Section title="4. Patient Data &amp; Confidentiality">
            <p>
              All patient information accessible through the Platform is strictly confidential.
              Staff members are bound by professional and legal obligations of confidentiality under
              the <strong>Health Service Commission Act</strong> and applicable Ugandan data protection
              regulations.
            </p>
            <p className="mt-3">
              Patient data must not be disclosed to any person outside the clinic except where required
              by law (e.g. court order or public health emergency) or with the explicit written consent
              of the patient.
            </p>
          </Section>

          {/* 5 */}
          <Section title="5. Medical Disclaimer">
            <p>
              The Code Clinic platform is a <strong>management and record-keeping tool</strong> only.
              It does not provide medical advice, diagnosis, or treatment recommendations. Any AI-assisted
              features (such as voice-to-text clinical notes or summaries) are provided as productivity
              aids and must be reviewed and verified by a qualified clinician before being used in
              patient care.
            </p>
            <p className="mt-3">
              Clinical decisions remain the sole responsibility of the attending healthcare professional.
            </p>
          </Section>

          {/* 6 */}
          <Section title="6. Availability &amp; Maintenance">
            <p>
              We aim to keep the Platform available at all times but do not guarantee uninterrupted
              access. We may carry out scheduled or emergency maintenance that temporarily affects
              availability. We will endeavour to notify users in advance of planned downtime where
              possible.
            </p>
            <p className="mt-3">
              We are not liable for any losses arising from unavailability of the Platform, including
              missed appointments or delays in accessing records.
            </p>
          </Section>

          {/* 7 */}
          <Section title="7. Intellectual Property">
            <p>
              The Code Clinic platform, including its design, source code, branding, and all content
              created by us, is the intellectual property of Code Clinic Dental Clinic. You may not
              copy, reproduce, modify, or distribute any part of the Platform without our express
              written permission.
            </p>
            <p className="mt-3">
              Patient records and clinical data remain the property of the clinic and the respective
              patients.
            </p>
          </Section>

          {/* 8 */}
          <Section title="8. Limitation of Liability">
            <p>
              To the fullest extent permitted by Ugandan law, Code Clinic Dental Clinic shall not be
              liable for any indirect, incidental, or consequential damages arising from your use of
              the Platform, including but not limited to:
            </p>
            <ul className="mt-3 space-y-2 list-none">
              <Li>Loss of data due to system failure or user error.</Li>
              <Li>Errors in AI-generated clinical notes that were not reviewed by a clinician.</Li>
              <Li>Interruptions to service caused by third-party providers.</Li>
            </ul>
            <p className="mt-3">
              Our total liability to you for any claim arising from use of the Platform shall not
              exceed the fees paid by your clinic for the service in the preceding 3 months.
            </p>
          </Section>

          {/* 9 */}
          <Section title="9. Termination of Access">
            <p>
              We reserve the right to suspend or terminate any account at any time for violation of
              these Terms, at the direction of clinic management, or upon a staff member's departure
              from the clinic.
            </p>
            <p className="mt-3">
              Upon termination, access to the Platform will be revoked immediately. Patient records
              associated with your role will remain in the system and accessible to other authorised staff.
            </p>
          </Section>

          {/* 10 */}
          <Section title="10. Governing Law">
            <p>
              These Terms are governed by and construed in accordance with the laws of the{' '}
              <strong>Republic of Uganda</strong>. Any disputes arising from or related to these Terms
              or your use of the Platform shall be subject to the exclusive jurisdiction of the courts
              of Uganda.
            </p>
          </Section>

          {/* 11 */}
          <Section title="11. Changes to These Terms">
            <p>
              We may update these Terms from time to time. When we make material changes, we will
              update the "Last updated" date at the top of this page. Continued use of the Platform
              after changes are posted constitutes your acceptance of the revised Terms.
            </p>
          </Section>

          {/* 12 */}
          <Section title="12. Contact Us">
            <p>
              For questions, concerns, or requests relating to these Terms, please contact:
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
            <Link href="/privacy" className="hover:text-[#1A237E] dark:hover:text-[#29ABE2] transition-colors">Privacy Policy</Link>
            <span>·</span>
            <Link href="/terms" className="text-[#1A237E] dark:text-[#29ABE2] font-medium">Terms of Service</Link>
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
