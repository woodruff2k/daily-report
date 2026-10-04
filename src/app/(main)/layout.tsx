import AppHeader from "./app-header";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="p-8">{children}</main>
    </div>
  );
}
