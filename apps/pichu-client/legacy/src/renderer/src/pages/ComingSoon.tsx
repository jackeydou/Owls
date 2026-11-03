type ComingSoonPageProps = {
  title: string
}

export function ComingSoonPage({ title }: ComingSoonPageProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border/80 bg-card px-8 py-10 text-center shadow-sm">
        <p className="text-[12px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </p>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">功能正在开发中</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">敬请期待</p>
      </section>
    </div>
  )
}
