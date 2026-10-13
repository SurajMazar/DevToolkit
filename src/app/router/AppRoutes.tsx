import { Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { categories, tools } from '@/registry'
import { ToolPage } from '@/components/tools/ToolPage'
import { HomePage } from '@/pages/HomePage'
import { CategoryPage } from '@/pages/CategoryPage'
import { FavoritesPage } from '@/pages/FavoritesPage'
import { RecentPage } from '@/pages/RecentPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/** Routes are generated from the tool registry. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="recent" element={<RecentPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {categories.map((c) => (
          <Route key={c.id} path={c.path} element={<CategoryPage category={c} />} />
        ))}
        {tools.map((t) => (
          <Route key={t.id} path={t.path} element={<ToolPage key={t.id} tool={t} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
