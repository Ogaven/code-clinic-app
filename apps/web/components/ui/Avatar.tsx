import { cn, getInitials } from '@/lib/utils'

interface AvatarProps {
  firstName: string
  lastName: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  colour?: string
  className?: string
}

const sizes = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
}

export default function Avatar({ firstName, lastName, avatarUrl, size = 'md', colour, className }: AvatarProps) {
  const initials = getInitials(firstName, lastName)
  const sizeClass = sizes[size]

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${firstName} ${lastName}`}
        className={cn('rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0', sizeClass, className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 border-2 border-white shadow-sm',
        sizeClass,
        className,
      )}
      style={{ backgroundColor: colour || '#1A237E' }}
    >
      {initials}
    </div>
  )
}
