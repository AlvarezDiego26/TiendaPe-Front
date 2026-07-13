import { Card } from '@heroui/react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Home,
  LogOut,
  Menu,
  Minus,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import tiendapeIcon from './assets/tiendape-icon.png'
import tiendapeLogo from './assets/tiendape-logo.png'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './index.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5162'

type View =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'cash'
  | 'purchases'
  | 'expenses'
  | 'reports'
  | 'settings'

type Product = {
  id: string
  name: string
  category: string
  internalCode: string | null
  barcode: string | null
  brand: string | null
  presentation: string | null
  unit: string | null
  supplier: string | null
  purchasePrice: number
  salePrice: number
  wholesalePrice: number | null
  stock: number
  minimumStock: number
  expirationDate: string | null
  location: string | null
  notes: string | null
  isActive: boolean
  isLowStock: boolean
}

type AuthResponse = {
  userId: string
  fullName: string
  email: string
  token: string
  expiresAt: string
}

type CashSession = {
  id: string
  openedAt: string
  closedAt: string | null
  openingAmount: number
  expectedAmount: number | null
  countedAmount: number | null
  difference: number | null
  cashSales: number
  digitalSales: number
  cashExpenses: number
  digitalExpenses: number
  hasNegativeStreakAlert: boolean
}

type Summary = {
  income: number
  expenses: number
  costOfGoodsSold: number
  netProfit: number
  cashSales: number
  digitalSales: number
}

type TopProduct = {
  productId: string
  productName: string
  quantity: number
  income: number
}

type SaleItemResponse = {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  subtotal: number
}

type SaleResponse = {
  id: string
  occurredAt: string
  paymentMethod: PaymentMethod
  total: number
  cashSessionId: string
  items: SaleItemResponse[]
}

type Expense = {
  id: string
  occurredAt: string
  category: string
  description: string
  amount: number
  paymentMethod: string
  isRecurring: boolean
  dueDay: number | null
  recurringStart: string | null
  recurringEnd: string | null
}

type CartItem = Product & { quantity: number }
type PaymentMethod = 'cash' | 'yape_plin'

type ToastKind = 'success' | 'error'
type Toast = { type: ToastKind; message: string } | null
type ApiRequestInit = RequestInit & { timeoutMs?: number }
type AlertLevel = 'danger' | 'warning' | 'info'
type BusinessAlert = { id: string; level: AlertLevel; title: string; detail: string; action?: View }

class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'pos', label: 'Venta rápida', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventario', icon: Boxes },
  { id: 'cash', label: 'Caja', icon: Wallet },
  { id: 'purchases', label: 'Compras', icon: PackagePlus },
  { id: 'expenses', label: 'Gastos', icon: ReceiptText },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
  { id: 'settings', label: 'Ajustes', icon: Settings },
]

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  maximumFractionDigits: 2,
})

const toApiDate = (date: Date) => date.toISOString()

const dayRange = () => {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  return { from: toApiDate(from), to: toApiDate(to) }
}

const monthRange = () => {
  const from = new Date()
  from.setDate(1)
  from.setHours(0, 0, 0, 0)
  const to = new Date()
  to.setMonth(to.getMonth() + 1, 0)
  to.setHours(23, 59, 59, 999)
  return { from: toApiDate(from), to: toApiDate(to) }
}

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    const raw = localStorage.getItem('tiendape.auth')
    return raw ? JSON.parse(raw) : null
  })
  const [view, setView] = useState<View>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [monthTopProducts, setMonthTopProducts] = useState<TopProduct[]>([])
  const [todaySales, setTodaySales] = useState<SaleResponse[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [cashSession, setCashSession] = useState<CashSession | null>(null)
  const [cashHistory, setCashHistory] = useState<CashSession[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [saleSubmitting, setSaleSubmitting] = useState(false)
  const [productsError, setProductsError] = useState(false)

  const authedFetch = async <T,>(path: string, options: ApiRequestInit = {}): Promise<T> => {
    const controller = options.signal ? null : new AbortController()
    const method = options.method?.toUpperCase() ?? 'GET'
    const timeoutMs = options.timeoutMs ?? (method === 'GET' ? 12000 : 35000)
    const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options

    let response: Response
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...fetchOptions,
        signal: options.signal ?? controller?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
          ...options.headers,
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('La base de datos demoro demasiado. Intenta de nuevo en unos segundos.')
      }

      throw error
    } finally {
      if (timeout) window.clearTimeout(timeout)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('tiendape.auth')
        setAuth(null)
        throw new ApiError('Tu sesion expiro. Ingresa nuevamente.', response.status, payload)
      }

      const message = typeof payload === 'string' && payload.trim() ? payload : `Error ${response.status}`
      throw new ApiError(message, response.status, payload)
    }

    return payload as T
  }

  const refresh = async () => {
    if (!auth) return
    setLoading(true)
    const load = async <T,>(action: () => Promise<T>, fallback: T, onError?: () => void) => {
      try {
        return await action()
      } catch {
        onError?.()
        return fallback
      }
    }

    try {
      setProductsError(false)
      const today = dayRange()
      const month = monthRange()
      const [currentCash, productData, summaryData, topData, monthTopData, todaySaleData, cashHistoryData, expenseData] = await Promise.all([
        load<CashSession | null>(() => authedFetch<CashSession>('/api/cash-sessions/current'), cashSession),
        load(() => authedFetch<Product[]>('/api/products?limit=300', { timeoutMs: 45000 }), products, () => setProductsError(true)),
        load(() => authedFetch<Summary>('/api/reports/summary'), summary),
        load(() => authedFetch<TopProduct[]>('/api/reports/top-products?limit=5'), topProducts),
        load(() => authedFetch<TopProduct[]>(`/api/reports/top-products?from=${encodeURIComponent(month.from)}&to=${encodeURIComponent(month.to)}&limit=5`), monthTopProducts),
        load(() => authedFetch<SaleResponse[]>(`/api/sales?from=${encodeURIComponent(today.from)}&to=${encodeURIComponent(today.to)}`, { timeoutMs: 45000 }), todaySales),
        load(() => authedFetch<CashSession[]>('/api/cash-sessions', { timeoutMs: 45000 }), cashHistory),
        load(() => authedFetch<Expense[]>('/api/expenses'), expenses),
      ])
      setCashSession(currentCash)
      setProducts(productData)
      setSummary(summaryData)
      setTopProducts(topData)
      setMonthTopProducts(monthTopData)
      setTodaySales(todaySaleData)
      setCashHistory(cashHistoryData)
      setExpenses(expenseData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [auth])

  const showToast = (type: ToastKind, message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 3600)
  }

  const handleAuth = (nextAuth: AuthResponse) => {
    localStorage.setItem('tiendape.auth', JSON.stringify(nextAuth))
    setAuth(nextAuth)
  }

  const logout = () => {
    localStorage.removeItem('tiendape.auth')
    setAuth(null)
  }

  const lowStock = products.filter((product) => product.isLowStock)
  const outOfStock = products.filter((product) => product.stock <= 0)
  const negativeCashSessions = cashHistory.filter((session) => (session.difference ?? 0) < 0).slice(0, 3)
  const businessAlerts: BusinessAlert[] = [
    ...outOfStock.slice(0, 3).map((product) => ({
      id: `out-${product.id}`,
      level: 'danger' as const,
      title: 'Producto sin stock',
      detail: `${product.name} esta en 0 unidades.`,
      action: 'inventory' as const,
    })),
    ...lowStock
      .filter((product) => product.stock > 0)
      .slice(0, 4)
      .map((product) => ({
        id: `low-${product.id}`,
        level: 'warning' as const,
        title: 'Stock bajo',
        detail: `${product.name}: quedan ${product.stock} unidades.`,
        action: 'inventory' as const,
      })),
    ...negativeCashSessions.map((session) => ({
      id: `cash-${session.id}`,
      level: 'danger' as const,
      title: 'Diferencia negativa en caja',
      detail: `${new Date(session.openedAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}: falta ${money.format(Math.abs(session.difference ?? 0))}.`,
      action: 'cash' as const,
    })),
    ...(summary && summary.netProfit < 0
      ? [{
          id: 'net-negative',
          level: 'warning' as const,
          title: 'Ganancia neta negativa',
          detail: `Hoy el neto va en ${money.format(summary.netProfit)}.`,
          action: 'dashboard' as const,
        }]
      : []),
    ...(!cashSession
      ? [{
          id: 'cash-closed',
          level: 'info' as const,
          title: 'Caja cerrada',
          detail: 'Abre turno antes de registrar ventas.',
          action: 'cash' as const,
        }]
      : []),
  ]
  const cartTotal = cart.reduce((sum, item) => sum + item.salePrice * item.quantity, 0)
  const showSearch = view === 'pos' || view === 'inventory'
  const filteredProducts = products.filter((product) => {
    const term = search.trim().toLowerCase()
    return (
      !term ||
      product.name.toLowerCase().includes(term) ||
      product.category.toLowerCase().includes(term) ||
      (product.internalCode ?? '').toLowerCase().includes(term) ||
      (product.barcode ?? '').toLowerCase().includes(term) ||
      (product.brand ?? '').toLowerCase().includes(term)
    )
  })

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      showToast('error', `${product.name} no tiene stock disponible.`)
      return
    }

    setCart((items) => {
      const current = items.find((item) => item.id === product.id)
      if (!current) return [...items, { ...product, quantity: 1 }]
      if (current.quantity >= product.stock) {
        showToast('error', `Stock máximo para ${product.name}: ${product.stock}.`)
        return items
      }
      return items.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
    })
  }

  const changeQuantity = (productId: string, delta: number) => {
    setCart((items) =>
      items
        .map((item) => {
          if (item.id !== productId) return item
          const quantity = Math.max(0, Math.min(item.stock, item.quantity + delta))
          return { ...item, quantity }
        })
        .filter((item) => item.quantity > 0),
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((items) => items.filter((item) => item.id !== productId))
  }

  const submitSale = async (paymentMethod: PaymentMethod) => {
    if (saleSubmitting) return

    if (!cashSession) {
      showToast('error', 'Primero abre un turno de caja.')
      setView('cash')
      return
    }

    if (cart.length === 0) {
      showToast('error', 'Agrega productos al carrito.')
      return
    }

    const soldItems = [...cart]
    const total = soldItems.reduce((sum, item) => sum + item.salePrice * item.quantity, 0)
    const cost = soldItems.reduce((sum, item) => sum + item.purchasePrice * item.quantity, 0)

    setSaleSubmitting(true)
    showToast('success', 'Registrando venta...')
    try {
      const sale = await authedFetch<SaleResponse>('/api/sales', {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({
          paymentMethod,
          items: soldItems.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      })
      setCart([])
      setTodaySales((current) => [{ ...sale, items: sale.items.length > 0 ? sale.items : soldItems.map((item) => ({
        productId: item.id,
        productName: item.name,
        quantity: item.quantity,
        unitPrice: item.salePrice,
        subtotal: item.salePrice * item.quantity,
      })) }, ...current])
      setProducts((current) =>
        current.map((product) => {
          const sold = soldItems.find((item) => item.id === product.id)
          if (!sold) return product
          const nextStock = Math.max(0, product.stock - sold.quantity)
          return { ...product, stock: nextStock, isLowStock: nextStock <= product.minimumStock }
        }),
      )
      setSummary((current) => {
        const base = current ?? { income: 0, expenses: 0, costOfGoodsSold: 0, netProfit: 0, cashSales: 0, digitalSales: 0 }
        return {
          ...base,
          income: base.income + total,
          costOfGoodsSold: base.costOfGoodsSold + cost,
          netProfit: base.netProfit + total - cost,
          cashSales: paymentMethod === 'cash' ? base.cashSales + total : base.cashSales,
          digitalSales: paymentMethod === 'yape_plin' ? base.digitalSales + total : base.digitalSales,
        }
      })
      setCashSession((current) =>
        current
          ? {
              ...current,
              cashSales: paymentMethod === 'cash' ? current.cashSales + total : current.cashSales,
              digitalSales: paymentMethod === 'yape_plin' ? current.digitalSales + total : current.digitalSales,
            }
          : current,
      )
      setTopProducts((current) => {
        const next = [...current]
        for (const item of soldItems) {
          const index = next.findIndex((product) => product.productId === item.id)
          if (index >= 0) {
            next[index] = {
              ...next[index],
              quantity: next[index].quantity + item.quantity,
              income: next[index].income + item.salePrice * item.quantity,
            }
          } else {
            next.push({
              productId: item.id,
              productName: item.name,
              quantity: item.quantity,
              income: item.salePrice * item.quantity,
            })
          }
        }
        return next.sort((a, b) => b.quantity - a.quantity).slice(0, 5)
      })
      setMonthTopProducts((current) => {
        const next = [...current]
        for (const item of soldItems) {
          const index = next.findIndex((product) => product.productId === item.id)
          if (index >= 0) {
            next[index] = {
              ...next[index],
              quantity: next[index].quantity + item.quantity,
              income: next[index].income + item.salePrice * item.quantity,
            }
          } else {
            next.push({
              productId: item.id,
              productName: item.name,
              quantity: item.quantity,
              income: item.salePrice * item.quantity,
            })
          }
        }
        return next.sort((a, b) => b.quantity - a.quantity).slice(0, 5)
      })
      showToast('success', 'Venta registrada.')
      void refresh()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo registrar la venta.')
    } finally {
      setSaleSubmitting(false)
    }
  }

  if (!auth) {
    return <AuthScreen onAuth={handleAuth} showToast={showToast} />
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <img alt="TiendaPe" src={tiendapeIcon} />
          </div>
          <div>
            <strong>TiendaPe</strong>
            <span>Gestión de tienda</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={view === item.id ? 'active' : ''}
                key={item.id}
                onClick={() => {
                  setView(item.id)
                  setMenuOpen(false)
                }}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <button className="logout-button" onClick={logout} type="button">
          <LogOut size={18} />
          Salir
        </button>
      </aside>

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} type="button" aria-label="Cerrar menú" />}

      <main className="main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMenuOpen(true)} type="button" aria-label="Abrir menú">
            <Menu size={22} />
          </button>
          <div>
            <span className="eyebrow">{new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <h1>{pageTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            {showSearch && (
              <div className="search-box">
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto..." />
              </div>
            )}
            <div className="alerts-menu">
              <button className="alert-button" aria-label="Ver alertas" onClick={() => setAlertsOpen((open) => !open)} type="button">
                <Bell size={18} />
                {businessAlerts.length > 0 && <span className="alert-count">{businessAlerts.length}</span>}
              </button>
              {alertsOpen && (
              <div className="alerts-panel">
                <div className="alerts-head">
                  <div>
                    <strong>Centro de alertas</strong>
                    <small>{businessAlerts.length === 0 ? 'Todo en orden' : `${businessAlerts.length} pendientes`}</small>
                  </div>
                  <span className={`alerts-status ${businessAlerts.length === 0 ? 'ok' : 'pending'}`}>
                    {businessAlerts.length === 0 ? 'OK' : 'Revisar'}
                  </span>
                </div>
                <div className="alerts-list">
                  {businessAlerts.length === 0 && <p className="empty-text">No hay alertas importantes.</p>}
                  {businessAlerts.slice(0, 8).map((alert) => (
                    <button
                      className={`alert-item ${alert.level}`}
                      key={alert.id}
                      onClick={() => {
                        if (alert.action) setView(alert.action)
                        setAlertsOpen(false)
                      }}
                      type="button"
                    >
                      <span className="alert-icon">
                        <AlertTriangle size={16} />
                      </span>
                      <span>
                        <strong>{alert.title}</strong>
                        <small>{alert.detail}</small>
                      </span>
                      <span className={`alert-chip ${alert.level}`}>
                        {alert.level === 'danger' ? 'Urgente' : alert.level === 'warning' ? 'Atencion' : 'Info'}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="alerts-footer"
                  onClick={() => {
                    const target = businessAlerts.find((alert) => alert.action)?.action
                    if (target) setView(target)
                    setAlertsOpen(false)
                  }}
                  type="button"
                >
                  Ver todas las notificaciones
                  <span>→</span>
                </button>
              </div>
              )}
            </div>
            <span className={`session-pill ${cashSession ? 'open' : 'closed'}`}>
              {cashSession ? 'Caja abierta' : 'Caja cerrada'}
            </span>
          </div>
        </header>

        {loading && <div className="loading-line" />}

        {view === 'dashboard' && (
          <Dashboard
            summary={summary}
            products={products}
            lowStock={lowStock}
            topProducts={topProducts}
            monthTopProducts={monthTopProducts}
            todaySales={todaySales}
            cashSession={cashSession}
            expenses={expenses}
            setView={setView}
          />
        )}

        {view === 'pos' && (
          <PosView
            products={filteredProducts}
            cart={cart}
            cartTotal={cartTotal}
            addToCart={addToCart}
            changeQuantity={changeQuantity}
            removeFromCart={removeFromCart}
            productsError={productsError}
            submitSale={submitSale}
            saleSubmitting={saleSubmitting}
          />
        )}

        {view === 'inventory' && <InventoryView products={filteredProducts} search={search} refresh={refresh} request={authedFetch} showToast={showToast} />}
        {view === 'cash' && (
          <CashView
            cashSession={cashSession}
            cashHistory={cashHistory}
            setCashSession={setCashSession}
            setCashHistory={setCashHistory}
            refresh={refresh}
            request={authedFetch}
            showToast={showToast}
          />
        )}
        {view === 'purchases' && <PurchasesView products={products} refresh={refresh} request={authedFetch} showToast={showToast} />}
        {view === 'expenses' && <ExpensesView expenses={expenses} refresh={refresh} request={authedFetch} showToast={showToast} />}
        {view === 'reports' && <ReportsView summary={summary} topProducts={topProducts} products={products} expenses={expenses} />}
        {view === 'settings' && <SettingsView apiUrl={API_URL} user={auth} />}
      </main>

      <nav className="bottom-nav">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon
          return (
            <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => setView(item.id)} type="button">
              <Icon size={19} />
              <span>{item.label.replace('Venta rápida', 'Venta')}</span>
            </button>
          )
        })}
      </nav>

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  )
}

function AuthScreen({ onAuth, showToast }: { onAuth: (auth: AuthResponse) => void; showToast: (type: ToastKind, message: string) => void }) {
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login')
  const [fullName, setFullName] = useState('Dueña TiendaPe')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 35000)

    try {
      const response = await fetch(`${API_URL}/api/auth/${mode}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'bootstrap' ? { fullName, email, password } : { email, password }),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(text.trim() || `Error ${response.status}`)
      onAuth(JSON.parse(text))
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'No se pudo conectar con el backend. Revisa que siga abierto en el puerto 5162.'
          : error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo ingresar.'
      showToast('error', message)
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand big">
          <img alt="TiendaPe - Gestion de tienda" className="brand-logo" src={tiendapeLogo} />
          <div className="brand-mark">
            <Store size={30} />
          </div>
          <div>
            <strong>TiendaPe</strong>
            <span>Control simple para tiendas pequeñas</span>
          </div>
        </div>
        <h1>Ventas, caja e inventario en una sola pantalla.</h1>
        <p>Diseñado para atender rápido en celular, revisar números en laptop y manejar la tienda sin complicarse.</p>
        <div className="auth-preview">
          <div>
            <span>Ganancia neta</span>
            <strong>S/ 1,248.50</strong>
          </div>
          <div>
            <span>Stock bajo</span>
            <strong>8 productos</strong>
          </div>
          <div>
            <span>Caja</span>
            <strong>Abierta</strong>
          </div>
        </div>
      </section>

      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">{mode === 'login' ? 'Bienvenida' : 'Primer acceso'}</span>
        <h2>{mode === 'login' ? 'Ingresa a tu panel' : 'Crea el usuario inicial'}</h2>
        {mode === 'bootstrap' && (
          <label>
            Nombre completo
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label>
          Contraseña
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? 'Conectando...' : mode === 'login' ? 'Entrar' : 'Crear usuario'}
        </button>
        <button className="link-button" type="button" onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}>
          {mode === 'login' ? 'Crear primer usuario' : 'Ya tengo usuario'}
        </button>
      </form>
    </div>
  )
}

function Dashboard({
  summary,
  products,
  lowStock,
  topProducts,
  monthTopProducts,
  todaySales,
  cashSession,
  expenses,
  setView,
}: {
  summary: Summary | null
  products: Product[]
  lowStock: Product[]
  topProducts: TopProduct[]
  monthTopProducts: TopProduct[]
  todaySales: SaleResponse[]
  cashSession: CashSession | null
  expenses: Expense[]
  setView: (view: View) => void
}) {
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const todayItems = todaySales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)
  const chartData = [
    { name: 'Ventas', value: summary?.income ?? 0 },
    { name: 'Gastos', value: summary?.expenses ?? 0 },
    { name: 'Costo', value: summary?.costOfGoodsSold ?? 0 },
    { name: 'Neto', value: summary?.netProfit ?? 0 },
  ]
  const pieData = [
    { name: 'Efectivo', value: summary?.cashSales ?? 0, color: '#5b2a86' },
    { name: 'Yape/Plin', value: summary?.digitalSales ?? 0, color: '#b985dd' },
  ]

  return (
    <div className="view-grid dashboard-grid">
      <Card className="welcome-panel">
        <div>
          <span className="eyebrow">Resumen del negocio</span>
          <h2>Hola, revisemos cómo va la tienda hoy.</h2>
          <p>La ganancia neta es el número principal: ventas menos costo de productos y gastos.</p>
        </div>
        <button className="primary-button" onClick={() => setView('pos')} type="button">
          Registrar venta
        </button>
      </Card>

      <MetricCard label="Ganancia neta" value={money.format(summary?.netProfit ?? 0)} icon={DollarSign} tone="green" />
      <MetricCard label="Ventas" value={money.format(summary?.income ?? 0)} icon={CreditCard} tone="blue" />
      <MetricCard label="Stock bajo" value={`${lowStock.length}`} icon={AlertTriangle} tone="amber" />
      <MetricCard label="Productos activos" value={`${products.length}`} icon={Boxes} tone="teal" />

      <Card className="panel chart-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Finanzas</span>
            <h3>Ingresos, gastos y ganancia</h3>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="4 4" stroke="#e2d7ef" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(value) => money.format(Number(value))} />
            <Line type="monotone" dataKey="value" stroke="#6c35a0" strokeWidth={3} dot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card className="panel payments-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Pagos</span>
            <h3>Efectivo vs Yape/Plin</h3>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={72}>
              {pieData.map((entry) => (
                <Cell fill={entry.color} key={entry.name} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => money.format(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="legend-row">
          <span>Efectivo {money.format(summary?.cashSales ?? 0)}</span>
          <span>Yape/Plin {money.format(summary?.digitalSales ?? 0)}</span>
        </div>
      </Card>

      <Card className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Hoy</span>
            <h3>Ventas realizadas</h3>
          </div>
          <div className="panel-stat">
            <strong>{money.format(todayTotal)}</strong>
            <span>{todaySales.length} ventas - {todayItems} productos</span>
          </div>
        </div>
        <div className="sale-list">
          {todaySales.length === 0 && <EmptyText text="Aun no hay ventas realizadas hoy." />}
          {todaySales.slice(0, 6).map((sale) => (
            <div className="sale-row" key={sale.id}>
              <div>
                <strong>{new Date(sale.occurredAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</strong>
                <span>{sale.paymentMethod === 'cash' ? 'Efectivo' : 'Yape/Plin'}</span>
              </div>
              <div className="sale-products">
                {sale.items.length === 0 ? (
                  <span>Venta sin detalle cargado</span>
                ) : (
                  sale.items.slice(0, 3).map((item) => (
                    <span key={`${sale.id}-${item.productId}`}>{item.productName} x{item.quantity}</span>
                  ))
                )}
                {sale.items.length > 3 && <span>+{sale.items.length - 3} productos mas</span>}
              </div>
              <b>{money.format(sale.total)}</b>
            </div>
          ))}
        </div>
      </Card>

      <Card className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Este mes</span>
            <h3>Productos lideres</h3>
          </div>
        </div>
        <div className="rank-list">
          {monthTopProducts.length === 0 && <EmptyText text="Sin ventas en el mes actual." />}
          {monthTopProducts.map((product, index) => (
            <div className="rank-item" key={product.productId}>
              <span>{index + 1}</span>
              <div>
                <strong>{product.productName}</strong>
                <small>{product.quantity} unidades este mes</small>
              </div>
              <b>{money.format(product.income)}</b>
            </div>
          ))}
        </div>
      </Card>

      <Card className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Más vendidos</span>
            <h3>Top productos</h3>
          </div>
        </div>
        <div className="rank-list">
          {topProducts.length === 0 && <EmptyText text="Aún no hay ventas registradas." />}
          {topProducts.map((product, index) => (
            <div className="rank-item" key={product.productId}>
              <span>{index + 1}</span>
              <div>
                <strong>{product.productName}</strong>
                <small>{product.quantity} unidades</small>
              </div>
              <b>{money.format(product.income)}</b>
            </div>
          ))}
        </div>
      </Card>

      <Card className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Caja</span>
            <h3>{cashSession ? 'Turno abierto' : 'Sin turno abierto'}</h3>
          </div>
        </div>
        <div className="cash-summary">
          <Wallet size={34} />
          <strong>{money.format(cashSession?.openingAmount ?? 0)}</strong>
          <span>Monto inicial</span>
        </div>
        <button className="secondary-button full" onClick={() => setView('cash')} type="button">
          Gestionar caja
        </button>
      </Card>

      <Card className="panel wide">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Control</span>
            <h3>Últimos gastos</h3>
          </div>
        </div>
        <div className="table-list">
          {expenses.slice(0, 5).map((expense) => (
            <div className="table-row expense-row" key={expense.id}>
              <span>{expense.description}</span>
              <small>{expense.category}</small>
              <b>{money.format(expense.amount)}</b>
            </div>
          ))}
          {expenses.length === 0 && <EmptyText text="Sin gastos registrados." />}
        </div>
      </Card>
    </div>
  )
}

function PosView({
  products,
  cart,
  cartTotal,
  addToCart,
  changeQuantity,
  removeFromCart,
  productsError,
  submitSale,
  saleSubmitting,
}: {
  products: Product[]
  cart: CartItem[]
  cartTotal: number
  addToCart: (product: Product) => void
  changeQuantity: (productId: string, delta: number) => void
  removeFromCart: (productId: string) => void
  productsError: boolean
  submitSale: (paymentMethod: PaymentMethod) => void
  saleSubmitting: boolean
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const cartUnits = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="pos-layout">
      <section className="product-grid">
        {products.map((product) => {
          const selected = cart.find((item) => item.id === product.id)?.quantity ?? 0

          return (
            <button className={`product-tile ${selected ? 'selected' : ''}`} key={product.id} onClick={() => addToCart(product)} type="button">
              {selected > 0 && <span className="selected-badge">{selected} en carrito</span>}
              <span>{product.category}</span>
              <strong>{product.name}</strong>
              <b>{money.format(product.salePrice)}</b>
              <small className={product.isLowStock ? 'danger' : ''}>Stock {product.stock}</small>
              <em>Agregar</em>
            </button>
          )
        })}
        {products.length === 0 && <EmptyText text={productsError ? 'No se pudo cargar productos. Revisa la conexion con la base de datos.' : 'No hay productos para mostrar.'} />}
      </section>
      <aside className="cart-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Venta rápida</span>
            <h3>Carrito</h3>
          </div>
          <div className="cart-count">
            <strong>{cartUnits}</strong>
            <span>und.</span>
          </div>
        </div>
        <div className="cart-total-box">
          <span>Total a cobrar</span>
          <strong>{money.format(cartTotal)}</strong>
        </div>
        <div className="cart-list">
          {cart.map((item) => (
            <div className="cart-item" key={item.id}>
              <div className="cart-item-main">
                <strong>{item.name}</strong>
                <span>{money.format(item.salePrice)} c/u · Subtotal {money.format(item.salePrice * item.quantity)}</span>
              </div>
              <div className="cart-item-actions">
                <div className="stepper" aria-label={`Cantidad de ${item.name}`}>
                  <button aria-label="Quitar una unidad" onClick={() => changeQuantity(item.id, -1)} type="button">
                    <Minus size={15} />
                  </button>
                  <input
                    aria-label={`Editar cantidad de ${item.name}`}
                    className="quantity-input"
                    min="1"
                    max={item.stock}
                    onChange={(event) => {
                      const nextQuantity = Math.max(1, Math.min(item.stock, Number(event.target.value) || 1))
                      changeQuantity(item.id, nextQuantity - item.quantity)
                    }}
                    type="number"
                    value={item.quantity}
                  />
                  <button aria-label="Agregar una unidad" onClick={() => changeQuantity(item.id, 1)} type="button">
                    <Plus size={15} />
                  </button>
                </div>
                <button className="remove-item-button" aria-label={`Eliminar ${item.name}`} onClick={() => removeFromCart(item.id)} type="button">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <div className="cart-empty">
              <ShoppingCart size={34} />
              <strong>Carrito vacio</strong>
              <span>Toca un producto para agregarlo a la venta.</span>
            </div>
          )}
        </div>
        <span className="payment-label">Forma de pago</span>
        <div className="payment-methods" aria-label="Método de pago">
          <button
            className={`payment-option ${paymentMethod === 'cash' ? 'active' : ''}`}
            onClick={() => setPaymentMethod('cash')}
            type="button"
          >
            Efectivo
          </button>
          <button
            className={`payment-option ${paymentMethod === 'yape_plin' ? 'active' : ''}`}
            onClick={() => setPaymentMethod('yape_plin')}
            type="button"
          >
            Yape/Plin
          </button>
        </div>
        <button className="primary-button full checkout-button" disabled={cart.length === 0 || saleSubmitting} onClick={() => submitSale(paymentMethod)} type="button">
          {saleSubmitting ? 'Registrando venta...' : cart.length === 0 ? 'Agrega productos para vender' : `Cobrar ${money.format(cartTotal)}`}
        </button>
      </aside>
    </div>
  )
}

function InventoryView({
  products,
  search,
  refresh,
  request,
  showToast,
}: {
  products: Product[]
  search: string
  refresh: () => Promise<void>
  request: <T>(path: string, options?: ApiRequestInit) => Promise<T>
  showToast: (type: ToastKind, message: string) => void
}) {
  const productFormDefaults = {
    name: '',
    category: 'General',
    internalCode: '',
    barcode: '',
    brand: '',
    presentation: '',
    unit: '',
    supplier: '',
    purchasePrice: '0',
    salePrice: '0',
    wholesalePrice: '',
    stock: '0',
    minimumStock: '0',
    expirationDate: '',
    location: '',
    notes: '',
  }
  const [form, setForm] = useState(productFormDefaults)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editForm, setEditForm] = useState(productFormDefaults)
  const [showAdvancedProductFields, setShowAdvancedProductFields] = useState(false)
  const [showAdvancedEditFields, setShowAdvancedEditFields] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [inventoryProducts, setInventoryProducts] = useState<Product[]>(products.slice(0, 12))
  const [isLoadingInventory, setIsLoadingInventory] = useState(false)

  const loadInventoryProducts = useCallback(async () => {
    setIsLoadingInventory(true)
    try {
      const query = search.trim()
      const path = `/api/products?limit=12${query ? `&search=${encodeURIComponent(query)}` : ''}`
      const data = await request<Product[]>(path, { timeoutMs: 18000 })
      setInventoryProducts(data)
    } catch (error) {
      setInventoryProducts(products.slice(0, 12))
      showToast('error', error instanceof Error ? error.message : 'No se pudo cargar el inventario.')
    } finally {
      setIsLoadingInventory(false)
    }
  }, [products, request, search, showToast])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInventoryProducts()
    }, 250)

    return () => window.clearTimeout(timer)
  }, [loadInventoryProducts])

  const productPayload = (value: typeof productFormDefaults) => ({
    name: value.name,
    category: value.category,
    internalCode: value.internalCode || null,
    barcode: value.barcode || null,
    brand: value.brand || null,
    presentation: value.presentation || null,
    unit: value.unit || null,
    supplier: value.supplier || null,
    purchasePrice: Number(value.purchasePrice),
    salePrice: Number(value.salePrice),
    wholesalePrice: value.wholesalePrice === '' ? null : Number(value.wholesalePrice),
    stock: Number(value.stock),
    minimumStock: Number(value.minimumStock),
    expirationDate: value.expirationDate || null,
    location: value.location || null,
    notes: value.notes || null,
  })

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await request('/api/products', {
        method: 'POST',
        body: JSON.stringify(productPayload(form)),
      })
      setForm(productFormDefaults)
      showToast('success', 'Producto creado.')
      await refresh()
      await loadInventoryProducts()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo crear el producto.')
    }
  }

  const openEdit = (product: Product) => {
    setEditingProduct(product)
    setShowAdvancedEditFields(false)
    setEditForm({
      name: product.name,
      category: product.category,
      purchasePrice: String(product.purchasePrice),
      salePrice: String(product.salePrice),
      stock: String(product.stock),
      minimumStock: String(product.minimumStock),
      internalCode: product.internalCode ?? '',
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      presentation: product.presentation ?? '',
      unit: product.unit ?? '',
      supplier: product.supplier ?? '',
      wholesalePrice: product.wholesalePrice === null ? '' : String(product.wholesalePrice),
      expirationDate: product.expirationDate ? product.expirationDate.slice(0, 10) : '',
      location: product.location ?? '',
      notes: product.notes ?? '',
    })
  }

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingProduct) return

    setIsSavingEdit(true)
    try {
      await request(`/api/products/${editingProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify(productPayload(editForm)),
      })
      showToast('success', 'Producto actualizado.')
      setEditingProduct(null)
      await refresh()
      await loadInventoryProducts()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo actualizar el producto.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  return (
    <div className="inventory-layout">
      <section className="panel inventory-form-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Nuevo producto</span>
            <h3>Inventario</h3>
          </div>
        </div>
        <form className="form-grid" onSubmit={save}>
          <label>
            Nombre
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Categoría
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </label>
          <label>
            Precio venta
            <input type="number" min="0" step="0.1" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} />
          </label>
          <label>
            Stock
            <input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} />
          </label>
          <label>
            Stock mínimo
            <input type="number" min="0" value={form.minimumStock} onChange={(event) => setForm({ ...form, minimumStock: event.target.value })} />
          </label>
          <label>
            Codigo de barras
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="Opcional" />
          </label>
          <div className="form-span advanced-toggle-row">
            <button className="secondary-button compact" onClick={() => setShowAdvancedProductFields((current) => !current)} type="button">
              {showAdvancedProductFields ? 'Ocultar datos avanzados' : 'Mas detalles'}
            </button>
            <small>Para costo, proveedor, vencimiento y datos internos.</small>
          </div>
          {showAdvancedProductFields && (
            <div className="form-span advanced-fields-grid">
              <label>
                Codigo interno
                <input value={form.internalCode} onChange={(event) => setForm({ ...form, internalCode: event.target.value })} />
              </label>
              <label>
                Marca
                <input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
              </label>
              <label>
                Presentacion
                <input value={form.presentation} onChange={(event) => setForm({ ...form, presentation: event.target.value })} />
              </label>
              <label>
                Unidad
                <input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
              </label>
              <label>
                Proveedor
                <input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} />
              </label>
              <label>
                Precio compra
                <input type="number" min="0" step="0.1" value={form.purchasePrice} onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })} />
              </label>
              <label>
                Precio mayor
                <input type="number" min="0" step="0.1" value={form.wholesalePrice} onChange={(event) => setForm({ ...form, wholesalePrice: event.target.value })} />
              </label>
              <label>
                Fecha vencimiento
                <input type="date" value={form.expirationDate} onChange={(event) => setForm({ ...form, expirationDate: event.target.value })} />
              </label>
              <label>
                Ubicacion
                <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
              </label>
              <label className="form-span">
                Observaciones
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} />
              </label>
            </div>
          )}
          <button className="primary-button" type="submit">
            Guardar producto
          </button>
        </form>
      </section>

      <section className="panel inventory-products-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Productos</span>
            <h3>{search.trim() ? 'Resultados' : 'Primeros productos'}</h3>
            <small>{isLoadingInventory ? 'Cargando desde servidor...' : `${inventoryProducts.length} visibles`}</small>
          </div>
        </div>
        <div className="inventory-list">
          {inventoryProducts.map((product) => (
            <div className="inventory-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{[product.brand, product.category, product.internalCode, product.barcode].filter(Boolean).join(' - ')}</span>
              </div>
              <b>{money.format(product.salePrice)}</b>
              <div className="inventory-actions">
                <small className={product.isLowStock ? 'danger pill' : 'pill'}>Stock {product.stock}</small>
                <button className="secondary-button compact" onClick={() => openEdit(product)} type="button">
                  Editar
                </button>
              </div>
            </div>
          ))}
          {!isLoadingInventory && inventoryProducts.length === 0 && <EmptyText text={search.trim() ? 'No se encontraron productos.' : 'No hay productos para mostrar.'} />}
        </div>
      </section>

      {editingProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingProduct(null)}>
          <section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-product-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">Editar producto</span>
                <h3 id="edit-product-title">{editingProduct.name}</h3>
              </div>
              <button className="icon-button" onClick={() => setEditingProduct(null)} type="button" aria-label="Cerrar modal">
                ×
              </button>
            </div>
            <form className="form-grid edit-product-form" onSubmit={saveEdit}>
              <label>
                Nombre
                <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required />
              </label>
              <label>
                Categoría
                <input value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} />
              </label>
              <label>
                Precio venta
                <input type="number" min="0" step="0.1" value={editForm.salePrice} onChange={(event) => setEditForm({ ...editForm, salePrice: event.target.value })} />
              </label>
              <label>
                Stock actual
                <input type="number" min="0" value={editForm.stock} onChange={(event) => setEditForm({ ...editForm, stock: event.target.value })} />
              </label>
              <label>
                Alerta stock mínimo
                <input type="number" min="0" value={editForm.minimumStock} onChange={(event) => setEditForm({ ...editForm, minimumStock: event.target.value })} />
              </label>
              <label>
                Codigo de barras
                <input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} />
              </label>
              <div className="form-span advanced-toggle-row">
                <button className="secondary-button compact" onClick={() => setShowAdvancedEditFields((current) => !current)} type="button">
                  {showAdvancedEditFields ? 'Ocultar datos avanzados' : 'Mas detalles'}
                </button>
                <small>Campos de compra, proveedor, vencimiento y ubicacion.</small>
              </div>
              {showAdvancedEditFields && (
                <div className="form-span advanced-fields-grid">
                  <label>
                    Codigo interno
                    <input value={editForm.internalCode} onChange={(event) => setEditForm({ ...editForm, internalCode: event.target.value })} />
                  </label>
                  <label>
                    Marca
                    <input value={editForm.brand} onChange={(event) => setEditForm({ ...editForm, brand: event.target.value })} />
                  </label>
                  <label>
                    Presentacion
                    <input value={editForm.presentation} onChange={(event) => setEditForm({ ...editForm, presentation: event.target.value })} />
                  </label>
                  <label>
                    Unidad
                    <input value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })} />
                  </label>
                  <label>
                    Proveedor
                    <input value={editForm.supplier} onChange={(event) => setEditForm({ ...editForm, supplier: event.target.value })} />
                  </label>
                  <label>
                    Precio compra
                    <input type="number" min="0" step="0.1" value={editForm.purchasePrice} onChange={(event) => setEditForm({ ...editForm, purchasePrice: event.target.value })} />
                  </label>
                  <label>
                    Precio mayor
                    <input type="number" min="0" step="0.1" value={editForm.wholesalePrice} onChange={(event) => setEditForm({ ...editForm, wholesalePrice: event.target.value })} />
                  </label>
                  <label>
                    Fecha vencimiento
                    <input type="date" value={editForm.expirationDate} onChange={(event) => setEditForm({ ...editForm, expirationDate: event.target.value })} />
                  </label>
                  <label>
                    Ubicacion
                    <input value={editForm.location} onChange={(event) => setEditForm({ ...editForm, location: event.target.value })} />
                  </label>
                  <label className="form-span">
                    Observaciones
                    <textarea value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} rows={3} />
                  </label>
                </div>
              )}
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setEditingProduct(null)} type="button">
                  Cancelar
                </button>
                <button className="primary-button" disabled={isSavingEdit} type="submit">
                  {isSavingEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

function CashView({
  cashSession,
  cashHistory,
  setCashSession,
  setCashHistory,
  refresh,
  request,
  showToast,
}: {
  cashSession: CashSession | null
  cashHistory: CashSession[]
  setCashSession: (session: CashSession | null) => void
  setCashHistory: React.Dispatch<React.SetStateAction<CashSession[]>>
  refresh: () => Promise<void>
  request: <T>(path: string, options?: ApiRequestInit) => Promise<T>
  showToast: (type: ToastKind, message: string) => void
}) {
  const [openingAmount, setOpeningAmount] = useState('0')
  const [countedAmount, setCountedAmount] = useState('')
  const [isOpening, setIsOpening] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [cashModal, setCashModal] = useState<'open' | 'close' | null>(null)
  const expectedCash = cashSession ? cashSession.openingAmount + cashSession.cashSales - cashSession.cashExpenses : 0
  const dailyCash = cashHistory.reduce<{ date: string; sessions: number; income: number; expenses: number; expected: number; difference: number }[]>((days, session) => {
    const date = new Date(session.openedAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
    const existing = days.find((day) => day.date === date)
    const income = session.cashSales + session.digitalSales
    const expected = session.expectedAmount ?? session.openingAmount + session.cashSales - session.cashExpenses
    const difference = session.difference ?? 0

    if (existing) {
      existing.sessions += 1
      existing.income += income
      existing.expenses += session.cashExpenses
      existing.expected += expected
      existing.difference += difference
      return days
    }

    return [...days, { date, sessions: 1, income, expenses: session.cashExpenses, expected, difference }]
  }, [])

  const openCash = async () => {
    if (isOpening) return
    setIsOpening(true)
    showToast('success', 'Abriendo turno de caja...')
    try {
      const opened = await request<CashSession>('/api/cash-sessions/open', {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({ openingAmount: Number(openingAmount) }),
      })
      setCashSession(opened)
      setCashModal(null)
      showToast('success', 'Turno abierto.')
      void refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isCashSession(error.data)) {
        setCashSession(error.data)
        showToast('success', 'Ya había un turno abierto. Lo sincronizamos.')
        void refresh()
        return
      }

      showToast('error', error instanceof Error ? error.message : 'No se pudo abrir caja.')
      void refresh()
    } finally {
      setIsOpening(false)
    }
  }

  const closeCash = async () => {
    if (!cashSession || isClosing) return
    const counted = Number(countedAmount)
    if (countedAmount.trim() === '' || Number.isNaN(counted)) {
      showToast('error', 'Ingresa el monto contado antes de cerrar caja.')
      return
    }

    const closingSession = cashSession
    setIsClosing(true)
    setCashSession(null)
    showToast('success', 'Cerrando turno de caja...')
    try {
      const closed = await request<CashSession>(`/api/cash-sessions/${closingSession.id}/close`, {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({ countedAmount: counted }),
      })
      setCashHistory((current) => [closed, ...current.filter((session) => session.id !== closed.id)])
      setCountedAmount('')
      setCashModal(null)
      showToast('success', 'Turno cerrado.')
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        setCountedAmount('')
        showToast('success', 'La caja ya estaba cerrada. Sincronizamos el estado.')
        return
      }

      setCashSession(closingSession)
      showToast('error', error instanceof Error ? error.message : 'No se pudo cerrar caja.')
    } finally {
      setIsClosing(false)
    }
  }

  return (
    <div className="cash-layout">
      <section className="panel cash-status-panel">
        <div>
          <span className="eyebrow">Caja actual</span>
          <h3>{cashSession ? 'Turno abierto' : 'Caja cerrada'}</h3>
          <p className="muted">
            {cashSession
              ? 'Revisa los importes del turno y cierra caja al finalizar el dia.'
              : 'Abre caja para comenzar a registrar ventas del turno.'}
          </p>
        </div>
        <button
          className="primary-button cash-action-button"
          disabled={isOpening || isClosing}
          onClick={() => {
            setCashModal(cashSession ? 'close' : 'open')
            setCountedAmount('')
          }}
          type="button"
        >
          {cashSession ? 'Cerrar caja' : 'Abrir caja'}
        </button>
      </section>

      {cashSession && (
        <section className="panel cash-numbers-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">Turno en curso</span>
              <h3>Resumen del efectivo</h3>
            </div>
            <strong>{money.format(expectedCash)}</strong>
          </div>
          <div className="cash-metric-grid">
            <MetricLine label="Monto inicial" value={money.format(cashSession.openingAmount)} />
            <MetricLine label="Ventas efectivo" value={money.format(cashSession.cashSales)} />
            <MetricLine label="Ventas Yape/Plin" value={money.format(cashSession.digitalSales)} />
            <MetricLine label="Gastos efectivo" value={money.format(cashSession.cashExpenses)} />
            <MetricLine label="Gastos Yape/Plin" value={money.format(cashSession.digitalExpenses ?? 0)} />
          </div>
        </section>
      )}

      <section className="panel cash-rule-panel">
        <span className="eyebrow">Regla de caja</span>
        <h3>Efectivo esperado</h3>
        <p className="muted">Monto inicial + ventas en efectivo - gastos en efectivo. Yape/Plin queda para reportes, no para conteo físico.</p>
      </section>
      <section className="panel cash-history-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Historial</span>
            <h3>Cierres por caja</h3>
          </div>
        </div>
        <div className="cash-history-list">
          {cashHistory.length === 0 && <EmptyText text="Todavia no hay turnos cerrados." />}
          {cashHistory.slice(0, 8).map((session) => (
            <div className="cash-history-row" key={session.id}>
              <div>
                <strong>{new Date(session.openedAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</strong>
                <span>
                  {new Date(session.openedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} -{' '}
                  {session.closedAt ? new Date(session.closedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : 'abierto'}
                </span>
              </div>
              <div className="cash-history-metrics">
                <span>Inicial {money.format(session.openingAmount)}</span>
                <span>Ventas {money.format(session.cashSales + session.digitalSales)}</span>
                <span>Gastos {money.format(session.cashExpenses)}</span>
              </div>
              <div className={`cash-difference ${(session.difference ?? 0) < 0 ? 'negative' : 'positive'}`}>
                <small>Diferencia</small>
                <strong>{money.format(session.difference ?? 0)}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel cash-daily-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">Por dia</span>
            <h3>Resumen de caja</h3>
          </div>
        </div>
        <div className="rank-list">
          {dailyCash.length === 0 && <EmptyText text="Cierra una caja para ver el resumen diario." />}
          {dailyCash.slice(0, 6).map((day) => (
            <div className="daily-row" key={day.date}>
              <div>
                <strong>{day.date}</strong>
                <span>{day.sessions} turnos</span>
              </div>
              <div>
                <span>Ingresos {money.format(day.income)}</span>
                <span>Gastos {money.format(day.expenses)}</span>
              </div>
              <b>{money.format(day.difference)}</b>
            </div>
          ))}
        </div>
      </section>

      {cashModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCashModal(null)}>
          <section className="edit-modal cash-modal" role="dialog" aria-modal="true" aria-labelledby="cash-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">{cashModal === 'open' ? 'Iniciar turno' : 'Finalizar turno'}</span>
                <h3 id="cash-modal-title">{cashModal === 'open' ? 'Abrir caja' : 'Cerrar caja'}</h3>
              </div>
              <button className="icon-button" onClick={() => setCashModal(null)} type="button" aria-label="Cerrar modal">
                Ã—
              </button>
            </div>

            {cashModal === 'open' ? (
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault()
                  void openCash()
                }}
              >
                <label>
                  Monto inicial
                  <input value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} type="number" min="0" step="0.1" autoFocus />
                </label>
                <p className="muted">Este monto es el efectivo con el que empieza el turno.</p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setCashModal(null)} type="button">
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={isOpening} type="submit">
                    {isOpening ? 'Abriendo...' : 'Abrir turno'}
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault()
                  void closeCash()
                }}
              >
                <div className="cash-close-summary">
                  <MetricLine label="Efectivo esperado" value={money.format(expectedCash)} />
                  <MetricLine label="Ventas Yape/Plin" value={money.format(cashSession?.digitalSales ?? 0)} />
                </div>
                <label>
                  Monto contado
                  <input value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} type="number" min="0" step="0.1" placeholder={money.format(expectedCash)} autoFocus />
                </label>
                <p className="muted">Cuenta solo el efectivo fisico de caja. Yape/Plin queda registrado en reportes.</p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setCashModal(null)} type="button">
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={isClosing} type="submit">
                    {isClosing ? 'Cerrando...' : 'Cerrar turno'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function isCashSession(value: unknown): value is CashSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'openedAt' in value &&
    'openingAmount' in value &&
    'closedAt' in value
  )
}

function PurchasesView({ products, refresh, request, showToast }: {
  products: Product[]
  refresh: () => Promise<void>
  request: <T>(path: string, options?: ApiRequestInit) => Promise<T>
  showToast: (type: ToastKind, message: string) => void
}) {
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitCost, setUnitCost] = useState('0')
  const [supplier, setSupplier] = useState('Proveedor')
  const selectedProduct = products.find((product) => product.id === productId)
  const quantityNumber = Math.max(0, Number(quantity) || 0)
  const unitCostNumber = Math.max(0, Number(unitCost) || 0)
  const purchaseTotal = quantityNumber * unitCostNumber
  const salePrice = selectedProduct?.salePrice ?? 0
  const unitMargin = salePrice - unitCostNumber
  const marginPercent = unitCostNumber > 0 ? (unitMargin / unitCostNumber) * 100 : 0
  const stockAfterPurchase = selectedProduct ? selectedProduct.stock + quantityNumber : quantityNumber

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await request('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({ supplier, items: [{ productId, quantity: Number(quantity), unitCost: Number(unitCost) }] }),
      })
      showToast('success', 'Compra registrada.')
      await refresh()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo registrar la compra.')
    }
  }

  return (
    <div className="purchase-layout">
    <Card className="panel form-panel">
      <span className="eyebrow">Reposición</span>
      <h3>Registrar compra</h3>
      <p className="muted form-help">Aqui registras mercaderia que entra. La cantidad se suma al stock del producto seleccionado.</p>
      <form className="form-grid" onSubmit={save}>
        <label>
          Proveedor
          <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Ej. Distribuidora Lima" />
        </label>
        <label>
          Producto registrado
          <select
            value={productId}
            onChange={(event) => {
              const nextProduct = products.find((product) => product.id === event.target.value)
              setProductId(event.target.value)
              if (nextProduct) setUnitCost(String(nextProduct.purchasePrice))
            }}
            required
          >
            <option value="">Seleccionar producto</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        <label>
          Cantidad que ingresa
          <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="1" />
        </label>
        <label>
          Costo de compra por unidad
          <input value={unitCost} onChange={(event) => setUnitCost(event.target.value)} type="number" min="0" step="0.1" />
        </label>
        <button className="primary-button" type="submit">Sumar stock y registrar compra</button>
      </form>
    </Card>
    <Card className="panel purchase-summary-panel">
      <span className="eyebrow">Vista previa</span>
      <h3>Impacto de la compra</h3>
      {selectedProduct ? (
        <div className="purchase-preview">
          <MetricLine label="Producto" value={selectedProduct.name} />
          <MetricLine label="Stock actual" value={`${selectedProduct.stock} unidades`} />
          <MetricLine label="Stock luego de comprar" value={`${stockAfterPurchase} unidades`} />
          <MetricLine label="Total de compra" value={money.format(purchaseTotal)} />
          <MetricLine label="Precio venta actual" value={money.format(salePrice)} />
          <MetricLine label="Ganancia estimada por unidad" value={`${money.format(unitMargin)} (${marginPercent.toFixed(1)}%)`} />
        </div>
      ) : (
        <EmptyText text="Selecciona un producto para ver el stock y la ganancia estimada." />
      )}
    </Card>
    </div>
  )
}

function ExpensesView({ expenses, refresh, request, showToast }: {
  expenses: Expense[]
  refresh: () => Promise<void>
  request: <T>(path: string, options?: ApiRequestInit) => Promise<T>
  showToast: (type: ToastKind, message: string) => void
}) {
  const emptyExpenseForm = { category: 'otros', description: '', amount: '0', paymentMethod: 'cash', isRecurring: false, dueDay: '1', recurringStart: '', recurringEnd: '' }
  const [form, setForm] = useState(emptyExpenseForm)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [editForm, setEditForm] = useState(emptyExpenseForm)

  const expensePayload = (value: typeof emptyExpenseForm) => ({
    category: value.category,
    description: value.description,
    amount: Number(value.amount),
    paymentMethod: value.paymentMethod,
    isRecurring: value.isRecurring,
    dueDay: value.isRecurring ? Number(value.dueDay) : null,
    recurringStart: value.isRecurring && value.recurringStart ? value.recurringStart : null,
    recurringEnd: value.isRecurring && value.recurringEnd ? value.recurringEnd : null,
  })

  const dateInputValue = (value: string | null) => (value ? value.slice(0, 10) : '')

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await request('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(expensePayload(form)),
      })
      setForm(emptyExpenseForm)
      showToast('success', 'Gasto registrado.')
      await refresh()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo registrar el gasto.')
    }
  }

  const openExpenseEdit = (expense: Expense) => {
    setEditingExpense(expense)
    setEditForm({
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      paymentMethod: expense.paymentMethod,
      isRecurring: expense.isRecurring,
      dueDay: String(expense.dueDay ?? 1),
      recurringStart: dateInputValue(expense.recurringStart),
      recurringEnd: dateInputValue(expense.recurringEnd),
    })
  }

  const saveEditExpense = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingExpense) return

    try {
      await request(`/api/expenses/${editingExpense.id}`, {
        method: 'PUT',
        body: JSON.stringify(expensePayload(editForm)),
      })
      setEditingExpense(null)
      showToast('success', 'Gasto actualizado.')
      await refresh()
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'No se pudo actualizar el gasto.')
    }
  }

  return (
    <div className="split-layout">
      <section className="panel">
        <span className="eyebrow">Salida de dinero</span>
        <h3>Registrar gasto</h3>
        <form className="form-grid" onSubmit={save}>
          <label>
            Categoría
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {['alquiler', 'servicios', 'transporte', 'sueldos', 'mantenimiento', 'otros'].map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Descripción
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </label>
          <label>
            Monto
            <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} type="number" min="0.1" step="0.1" />
          </label>
          <label>
            Método
            <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}>
              <option value="cash">Efectivo</option>
              <option value="yape_plin">Yape/Plin</option>
            </select>
          </label>
          <label className="check-row">
            <input checked={form.isRecurring} onChange={(event) => setForm({ ...form, isRecurring: event.target.checked })} type="checkbox" />
            Es fijo mensual
          </label>
          {form.isRecurring && (
            <label>
              Día de vencimiento
              <input value={form.dueDay} onChange={(event) => setForm({ ...form, dueDay: event.target.value })} type="number" min="1" max="31" />
            </label>
          )}
          {form.isRecurring && (
            <>
              <label>
                Desde
                <input value={form.recurringStart} onChange={(event) => setForm({ ...form, recurringStart: event.target.value })} type="date" />
              </label>
              <label>
                Hasta
                <input value={form.recurringEnd} onChange={(event) => setForm({ ...form, recurringEnd: event.target.value })} type="date" />
              </label>
            </>
          )}
          <button className="primary-button" type="submit">Guardar gasto</button>
        </form>
      </section>
      <section className="panel wide">
        <span className="eyebrow">Historial</span>
        <h3>Gastos recientes</h3>
        <div className="table-list">
          {expenses.map((expense) => (
            <div className="table-row expense-row" key={expense.id}>
              <span>{expense.description}</span>
              <small>{expense.category}</small>
              <b>{money.format(expense.amount)}</b>
              <button className="secondary-button compact" onClick={() => openExpenseEdit(expense)} type="button">
                Editar
              </button>
            </div>
          ))}
        </div>
      </section>
      {editingExpense && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingExpense(null)}>
          <section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-expense-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">Editar gasto</span>
                <h3 id="edit-expense-title">{editingExpense.description}</h3>
              </div>
              <button className="icon-button" onClick={() => setEditingExpense(null)} type="button" aria-label="Cerrar modal">
                x
              </button>
            </div>
            <form className="form-grid edit-product-form" onSubmit={saveEditExpense}>
              <label>
                Categoria
                <select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                  {['alquiler', 'servicios', 'transporte', 'sueldos', 'mantenimiento', 'otros'].map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Nombre / descripcion
                <input value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} required />
              </label>
              <label>
                Monto
                <input value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} type="number" min="0.1" step="0.1" />
              </label>
              <label>
                Metodo
                <select value={editForm.paymentMethod} onChange={(event) => setEditForm({ ...editForm, paymentMethod: event.target.value })}>
                  <option value="cash">Efectivo</option>
                  <option value="yape_plin">Yape/Plin</option>
                </select>
              </label>
              <label className="check-row">
                <input checked={editForm.isRecurring} onChange={(event) => setEditForm({ ...editForm, isRecurring: event.target.checked })} type="checkbox" />
                Es fijo mensual
              </label>
              {editForm.isRecurring && (
                <>
                  <label>
                    Dia de vencimiento
                    <input value={editForm.dueDay} onChange={(event) => setEditForm({ ...editForm, dueDay: event.target.value })} type="number" min="1" max="31" />
                  </label>
                  <label>
                    Desde
                    <input value={editForm.recurringStart} onChange={(event) => setEditForm({ ...editForm, recurringStart: event.target.value })} type="date" />
                  </label>
                  <label>
                    Hasta
                    <input value={editForm.recurringEnd} onChange={(event) => setEditForm({ ...editForm, recurringEnd: event.target.value })} type="date" />
                  </label>
                </>
              )}
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setEditingExpense(null)} type="button">
                  Cancelar
                </button>
                <button className="primary-button" type="submit">
                  Guardar cambios
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

function ReportsView({ summary, topProducts, products, expenses }: { summary: Summary | null; topProducts: TopProduct[]; products: Product[]; expenses: Expense[] }) {
  const inventoryValue = products.reduce((sum, product) => sum + product.purchasePrice * product.stock, 0)
  const expenseChart = expenses.slice(0, 8).map((expense) => ({ name: expense.description.slice(0, 10), value: expense.amount }))

  return (
    <div className="view-grid">
      <MetricCard label="Valor inventario" value={money.format(inventoryValue)} icon={Boxes} tone="teal" />
      <MetricCard label="Ganancia neta" value={money.format(summary?.netProfit ?? 0)} icon={DollarSign} tone="green" />
      <MetricCard label="Egresos" value={money.format(summary?.expenses ?? 0)} icon={ReceiptText} tone="amber" />
      <section className="panel wide">
        <span className="eyebrow">Top productos</span>
        <h3>Ventas por producto</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={topProducts}>
            <CartesianGrid strokeDasharray="4 4" stroke="#d6e2e4" />
            <XAxis dataKey="productName" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="quantity" fill="#6c35a0" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="panel">
        <span className="eyebrow">Gastos</span>
        <h3>Últimos montos</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={expenseChart}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(value) => money.format(Number(value))} />
            <Bar dataKey="value" fill="#e0a45b" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}

function SettingsView({ apiUrl, user }: { apiUrl: string; user: AuthResponse }) {
  return (
    <section className="panel form-panel">
      <span className="eyebrow">Configuración</span>
      <h3>TiendaPe</h3>
      <MetricLine label="Usuario" value={user.email} />
      <MetricLine label="API" value={apiUrl} />
      <MetricLine label="Modo" value="Web responsive / PWA ready" />
    </section>
  )
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Home; tone: string }) {
  return (
    <Card className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Icon size={24} />
    </Card>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return <p className="empty-text">{text}</p>
}

function pageTitle(view: View) {
  const match = navItems.find((item) => item.id === view)
  return match?.label ?? 'Dashboard'
}

export default App
