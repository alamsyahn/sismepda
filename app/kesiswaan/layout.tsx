import { KesiswaanDraftProvider } from "@/components/kesiswaan/draft-provider"
export default function Layout({ children }: { children: React.ReactNode }) { return <KesiswaanDraftProvider>{children}</KesiswaanDraftProvider> }
