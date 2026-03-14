export function SkeletonNote() {
  return (
    <div className="px-4 py-3 border-b border-border animate-pulse">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-sm bg-bg-raised shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-24 bg-bg-raised rounded-sm" />
            <div className="h-3 w-12 bg-bg-raised rounded-sm" />
          </div>
          <div className="h-3 w-full bg-bg-raised rounded-sm" />
          <div className="h-3 w-3/4 bg-bg-raised rounded-sm" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonNoteList({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonNote key={i} />
      ))}
    </>
  );
}

export function SkeletonProfile() {
  return (
    <div className="animate-pulse">
      <div className="h-32 bg-bg-raised" />
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-sm bg-bg-raised border-2 border-bg -mt-10" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-32 bg-bg-raised rounded-sm" />
            <div className="h-3 w-20 bg-bg-raised rounded-sm" />
          </div>
        </div>
        <div className="h-3 w-full bg-bg-raised rounded-sm" />
        <div className="h-3 w-2/3 bg-bg-raised rounded-sm" />
      </div>
    </div>
  );
}
