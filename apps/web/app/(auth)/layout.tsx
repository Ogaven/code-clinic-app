import SarahChatbot from '@/components/SarahChatbot'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SarahChatbot />
    </>
  )
}
