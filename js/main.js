// --- 1. Global Storage Keys ---
const KEYS =  {
    TRANSACTIONS: 'app_transactions', SAVINGS_GOALS: 'app_savings_goals', USER_PROFILE: 'app_user_profile', MONTHLY_REPORTS: 'app_monthly_reports', CALENDAR_EVENTS: 'app_calendar_events', CUSTOM_CATEGORIES: 'app_custom_categories', BUDGETS: 'app_budgets', RECURRING: 'app_recurring_transactions', BILLS: 'app_bills', SUBSCRIPTIONS: 'app_subscriptions', DEBTS: 'app_debts', WALLETS: 'app_wallets'
};
const ACTIVE_UID_KEY = 'smarttracker_active_uid';
function clearUserCache()  {
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
}
// --- Time-based greeting helper ---
function getTimeGreeting(name)  {
    const hour = new Date().getHours();
    let part;
    if (hour < 12) part = 'Good morning';
    else if (hour < 17) part = 'Good afternoon';
    else part = 'Good evening';
    const who = name ? `, ${name}` : '';
    return `${part}${who}!`;
}
// --- 2. "App Ready" gate ---------------------------------------------------
let _appReady = false;
const _readyCallbacks = [];
function onAppReady(cb)  {
    if (_appReady) cb();
    else _readyCallbacks.push(cb);
}
function markAppReady()  {
    _appReady = true;
    document.body.classList.remove('app-loading');
    const sk = document.getElementById('app-loading-skeleton');
    if (sk) sk.style.display = 'none';
    _readyCallbacks.forEach((cb) => cb());
    _readyCallbacks.length = 0;
}
// --- 3. Firebase Auth Guard + Cloud Sync -----------------------------------
const isLoginPage = window.location.pathname.toLowerCase().endsWith('login.html');
window.currentUserId = null;
auth.onAuthStateChanged(async (user) =>  {
    if (!user)  {
        window.currentUserId = null;
        if (!isLoginPage) window.location.href = 'login.html';
        return;
    }
    // Refresh verification state when online. If the installed PWA is offline,
    // keep using Firebase Auth's locally persisted verified session instead of
    // leaving the app stuck on the loading state.
    try  {
        await user.reload();
    } catch (err)  {
        if (navigator.onLine) console.warn('Could not refresh Firebase user:', err);
    }
    const freshUser = auth.currentUser || user;
    if (!freshUser || !freshUser.emailVerified)  {
        window.currentUserId = null;
        if (!isLoginPage)  {
            await auth.signOut();
            window.location.href = 'login.html';
        }
        return;
    }
    if (isLoginPage)  {
        window.location.href = 'index.html';
        return;
    }
    // Never mix one Firebase account's cached data with another account.
    const previousUid = localStorage.getItem(ACTIVE_UID_KEY);
    if (previousUid && previousUid !== freshUser.uid) clearUserCache();
    localStorage.setItem(ACTIVE_UID_KEY, freshUser.uid);
    window.currentUserId = freshUser.uid;
    await pullCloudDataIntoCache(freshUser.uid);
    markAppReady();
});
async function pullCloudDataIntoCache(uid)  {
    let cloudExists = false;
    let cloudData = {};
    try  {
        const snap = await db.collection('users').doc(uid).get();
        if (snap.exists)  {
            cloudExists = true;
            const data = snap.data() ||  {
            };
            cloudData = data;
            Object.values(KEYS).forEach((storageKey) =>  {
                if (data[storageKey] !== undefined)  {
                    localStorage.setItem(storageKey, JSON.stringify(data[storageKey]));
                } else  {
                    localStorage.removeItem(storageKey);
                }
            });
        } else  {
            // Brand-new account (for example Google sign-in): start with a clean cache.
            clearUserCache();
        }
    } catch (err)  {
        console.error('Could not load cloud data, using local cache instead:', err);
    }
    if (!getUserProfile())  {
        const user = auth.currentUser;
        let username = 'user';
        if (user && user.email) username = user.email.split('@')[0] || 'user';
        const seed =  {
            username: username, fullname: (user && user.displayName) || '', email: (user && user.email) || '', age: '', dob: '', job: '', country: '', phone: '', currency: 'LKR', photo: (user && user.photoURL) || null
        };
        localStorage.setItem(KEYS.USER_PROFILE, JSON.stringify(seed));
        if (!cloudExists)  {
            const initial =  {
            };
            initial[KEYS.USER_PROFILE] = seed;
            initial[KEYS.TRANSACTIONS] = [];
            initial[KEYS.SAVINGS_GOALS] = [];
            initial[KEYS.MONTHLY_REPORTS] = [];
            initial[KEYS.CALENDAR_EVENTS] = [];
            initial[KEYS.CUSTOM_CATEGORIES] = [];
            initial[KEYS.BUDGETS] = [];
            initial[KEYS.RECURRING] = [];
            initial[KEYS.BILLS] = [];
            initial[KEYS.SUBSCRIPTIONS] = [];
            initial[KEYS.DEBTS] = [];
            initial[KEYS.WALLETS] = defaultWallets();
            try  {
                await db.collection('users').doc(uid).set(initial,  {
                    merge: true
                });
            } catch (err)  {
                console.error('Could not initialize cloud profile:', err);
            }
        }
    }
    // Older/migrated accounts may not contain every newer SmartTracker dataset.
    // Add only missing fields so existing cloud data is never overwritten.
    if (cloudExists)  {
        const missing = {};
        Object.values(KEYS).forEach((storageKey) =>  {
            if (cloudData[storageKey] !== undefined) return;
            let value;
            if (storageKey === KEYS.USER_PROFILE) value = getUserProfile() || {};
            else if (storageKey === KEYS.WALLETS) value = defaultWallets();
            else value = [];
            localStorage.setItem(storageKey, JSON.stringify(value));
            missing[storageKey] = value;
        });
        if (Object.keys(missing).length)  {
            try  {
                await db.collection('users').doc(uid).set(missing, { merge: true });
            } catch (err)  {
                console.error('Could not add missing SmartTracker datasets:', err);
            }
        }
    }
    // Normalize older records after cloud data is loaded. This keeps old
    // locale-formatted dates and savings deposits compatible with monthly views.
    normalizeTransactionStore();
    processAutomaticTransactions();
}
function pushToCloud(key, value)  {
    const uid = window.currentUserId;
    if (!uid) return;
    const status = document.getElementById('sync-status');
    if (status) status.textContent = navigator.onLine ? '☁️ Syncing…' : 'Offline — changes will sync when connected';
    db.collection('users') .doc(uid) .set({
        [key]: value
    },  {
        merge: true
    }) .then(() =>  {
        localStorage.setItem('smarttracker_last_sync', new Date().toISOString());
        const el = document.getElementById('sync-status');
        if (el) el.textContent = navigator.onLine ? '☁️ Last synced: just now' : 'Offline — changes will sync when connected';
    }) .catch((err) => console.error('Cloud save failed for', key, err));
}
// --- 4. Storage Helper Functions -------------------------------------------
function getStorageData(key)  {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}
function setStorageData(key, value)  {
    localStorage.setItem(key, JSON.stringify(value));
    pushToCloud(key, value);
}
// --- Shared finance/date helpers -------------------------------------------
const SMART_WALLETS = ['Cash', 'Bank', 'Card'];
function defaultWallets()  {
    return [ {
        id: 'cash', name: 'Cash', icon: '💵', openingBalance: 0
    },  {
        id: 'bank', name: 'Bank', icon: '🏦', openingBalance: 0
    },  {
        id: 'card', name: 'Card', icon: '💳', openingBalance: 0
    } ];
}
function getWallets()  {
    let list = getStorageData(KEYS.WALLETS);
    if (!Array.isArray(list) || !list.length) return defaultWallets();
    const seen = new Set();
    return list.filter((w) => w && String(w.name || '').trim()).map((w, i) =>  {
        const name = String(w.name).trim();
        const key = name.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        return  {
            id: w.id || ('wallet-' + i + '-' + Date.now()), name, icon: w.icon || '👛', openingBalance: Number(w.openingBalance) || 0
        };
    }).filter(Boolean);
}
function saveWallets(wallets)  {
    setStorageData(KEYS.WALLETS, wallets);
}
function getWalletNames()  {
    return getWallets().map((w) => w.name);
}
function isKnownWallet(name)  {
    return getWalletNames().includes(name);
}
function toLocalISODate(value)  {
    if (!value) return '';
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseTransactionDate(value)  {
    const iso = toLocalISODate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
}
function monthKeyFromDate(value)  {
    const iso = toLocalISODate(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(0, 7) : '';
}
function currentMonthKey()  {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function computeWalletBalances(transactions)  {
    const balances =  {
    };
    getWallets().forEach((w) =>  {
        balances[w.name] = Number(w.openingBalance) || 0;
    });
    (transactions || []).forEach((tx) =>  {
        const amount = Number(tx.amount) || 0;
        if (tx.type === 'transfer')  {
            const from = tx.fromAccount || 'Cash';
            const to = tx.toAccount || 'Bank';
            if (balances[from] === undefined) balances[from] = 0;
            if (balances[to] === undefined) balances[to] = 0;
            balances[from] -= amount;
            balances[to] += amount;
            return;
        }
        const account = tx.account || 'Cash';
        if (balances[account] === undefined) balances[account] = 0;
        if (tx.type === 'income') balances[account] += amount;
        if (tx.type === 'expense') balances[account] -= amount;
    });
    return balances;
}
function getWalletBalances()  {
    return computeWalletBalances(getStorageData(KEYS.TRANSACTIONS));
}
function getWalletAvailable(wallet, excludeTxId)  {
    const balances = getWalletBalances();
    let available = Number(balances[wallet]) || 0;
    if (excludeTxId)  {
        const old = getStorageData(KEYS.TRANSACTIONS).find((tx) => tx.id === excludeTxId);
        if (old)  {
            if (old.type === 'expense' && (old.account || 'Cash') === wallet) available += Number(old.amount) || 0;
            if (old.type === 'transfer' && old.fromAccount === wallet) available += Number(old.amount) || 0;
        }
    }
    return available;
}
function totalNetBeforeMonth(monthKey, transactions)  {
    let total = 0;
    (transactions || []).forEach((tx) =>  {
        if (tx.type === 'transfer') return;
        const txMonth = monthKeyFromDate(tx.date);
        if (!txMonth || txMonth >= monthKey) return;
        const amount = Number(tx.amount) || 0;
        if (tx.type === 'income') total += amount;
        if (tx.type === 'expense') total -= amount;
    });
    return total;
}
function normalizeTransactionStore()  {
    const transactions = getStorageData(KEYS.TRANSACTIONS);
    if (!Array.isArray(transactions)) return;
    let changed = false;
    transactions.forEach((tx) =>  {
        const normalizedDate = toLocalISODate(tx.date);
        if (normalizedDate && normalizedDate !== tx.date)  {
            tx.date = normalizedDate;
            changed = true;
        }
        if (tx.type !== 'transfer' && !tx.account)  {
            tx.account = 'Cash';
            changed = true;
        }
    });
    if (changed) setStorageData(KEYS.TRANSACTIONS, transactions);
}
function getUserProfile()  {
    try  {
        const raw = localStorage.getItem(KEYS.USER_PROFILE);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed;
    } catch  {
        return null;
    }
}
function saveUserProfile(profile)  {
    localStorage.setItem(KEYS.USER_PROFILE, JSON.stringify(profile));
    pushToCloud(KEYS.USER_PROFILE, profile);
}
// --- Currency helpers ---
const CURRENCY_MAP =  {
    LKR:  {
        symbol: 'Rs.', locale: 'en-LK', code: 'LKR'
    }, USD:  {
        symbol: '$', locale: 'en-US', code: 'USD'
    }, EUR:  {
        symbol: '€', locale: 'de-DE', code: 'EUR'
    }, GBP:  {
        symbol: '£', locale: 'en-GB', code: 'GBP'
    }, INR:  {
        symbol: '₹', locale: 'en-IN', code: 'INR'
    }
};
function getCurrency()  {
    const p = getUserProfile();
    const code = (p && p.currency) || 'LKR';
    return CURRENCY_MAP[code] || CURRENCY_MAP.LKR;
}
function formatMoney(amount)  {
    const c = getCurrency();
    const n = parseFloat(amount) || 0;
    return `${c.symbol} ${n.toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatRs(amount)  {
    return formatMoney(amount);
}
// --- Calendar event helpers ---
function getCalendarEvents()  {
    return getStorageData(KEYS.CALENDAR_EVENTS);
}
function setCalendarEvents(events)  {
    setStorageData(KEYS.CALENDAR_EVENTS, events);
}
function addCalendarEvent(event)  {
    const events = getCalendarEvents();
    events.push(event);
    setCalendarEvents(events);
    return event;
}
// --- Custom categories helpers ---
function getCustomCategories()  {
    const list = getStorageData(KEYS.CUSTOM_CATEGORIES);
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && c.trim()) : [];
}
function setCustomCategories(list)  {
    const cleaned = (list || []) .map((c) => String(c || '').trim()) .filter(Boolean) .filter((c, i, arr) => arr.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
    setStorageData(KEYS.CUSTOM_CATEGORIES, cleaned);
    return cleaned;
}
function addCustomCategory(name)  {
    const n = String(name || '').trim();
    if (!n) return getCustomCategories();
    const list = getCustomCategories();
    if (list.some((c) => c.toLowerCase() === n.toLowerCase())) return list;
    list.push(n);
    return setCustomCategories(list);
}
function removeCustomCategory(name)  {
    const n = String(name || '').trim().toLowerCase();
    return setCustomCategories(getCustomCategories().filter((c) => c.toLowerCase() !== n));
}
// --- Date display preference helpers ---
function getDateFormat()  {
    const p = getUserProfile();
    return (p && p.dateFormat) || 'DD/MM/YYYY';
}
function formatAppDate(value)  {
    const d = parseTransactionDate(value);
    if (!d) return String(value || '');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const f = getDateFormat();
    if (f === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
    if (f === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
    return `${dd}/${mm}/${yyyy}`;
}
function addDaysISO(iso, days)  {
    const d = parseTransactionDate(iso) || new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addMonthsISO(iso, months)  {
    const d = parseTransactionDate(iso) || new Date();
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, max));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function advanceRecurringDate(iso, frequency)  {
    if (frequency === 'weekly') return addDaysISO(iso, 7);
    if (frequency === 'yearly') return addMonthsISO(iso, 12);
    return addMonthsISO(iso, 1);
}
function ensureAutoTransaction(def, kind)  {
    const today = toLocalISODate(new Date());
    if (!def.active || !def.nextDate || def.nextDate > today) return false;
    let changed = false;
    const transactions = getStorageData(KEYS.TRANSACTIONS);
    let guard = 0;
    while (def.active && def.nextDate && def.nextDate <= today && guard++ < 60)  {
        const occurrenceKey = `${kind}:${def.id}:${def.nextDate}`;
        if (!transactions.some((tx) => tx.autoKey === occurrenceKey))  {
            const amount = Number(def.amount) || 0;
            const account = def.wallet || 'Cash';
            if (def.type !== 'expense' || getWalletAvailable(account) + 1e-9 >= amount)  {
                transactions.push({
                    id: Date.now() + Math.floor(Math.random() * 100000), type: def.type || 'expense', category: def.category || (kind === 'subscription' ? 'Subscriptions' : 'Other'), account, amount, description: def.name || def.description || (kind === 'subscription' ? 'Subscription' : 'Recurring transaction'), date: def.nextDate, autoKey: occurrenceKey, sourceKind: kind, sourceId: def.id
                });
                changed = true;
            } else  {
                break;
            }
        }
        def.lastGenerated = def.nextDate;
        def.nextDate = advanceRecurringDate(def.nextDate, def.frequency || def.cycle || 'monthly');
        changed = true;
    }
    if (changed) setStorageData(KEYS.TRANSACTIONS, transactions);
    return changed;
}
function processAutomaticTransactions()  {
    const recurring = getStorageData(KEYS.RECURRING);
    let recurringChanged = false;
    recurring.forEach((r) =>  {
        if (ensureAutoTransaction(r, 'recurring')) recurringChanged = true;
    });
    if (recurringChanged) setStorageData(KEYS.RECURRING, recurring);
    const subscriptions = getStorageData(KEYS.SUBSCRIPTIONS);
    let subChanged = false;
    subscriptions.forEach((s) =>  {
        if (s.autoRecord && ensureAutoTransaction(s, 'subscription')) subChanged = true;
    });
    if (subChanged) setStorageData(KEYS.SUBSCRIPTIONS, subscriptions);
}
function isSavingsDeposit(tx)  {
    return tx && tx.type === 'expense' && tx.category === 'Savings Deposit';
}

function getMonthTotals(key)  {
    const txs = getStorageData(KEYS.TRANSACTIONS);
    let income = 0;
    let expense = 0;
    let savings = 0;

    txs.forEach((tx) =>  {
        if (tx.type === 'transfer' || monthKeyFromDate(tx.date) !== key) return;

        const amount = Number(tx.amount) || 0;

        if (tx.type === 'income')  {
            income += amount;
            return;
        }

        if (isSavingsDeposit(tx))  {
            savings += amount;
            return;
        }

        if (tx.type === 'expense')  {
            expense += amount;
        }
    });

    const opening = totalNetBeforeMonth(key, txs)
        + getWallets().reduce((sum, wallet) => sum + (Number(wallet.openingBalance) || 0), 0);

    return  {
        income,
        expense,
        savings,
        opening,
        cashChange: income - expense - savings,
        closing: opening + income - expense - savings
    };
}
function calculateFinancialHealth()  {
    const key = currentMonthKey();
    const totals = getMonthTotals(key);
    const budgets = getStorageData(KEYS.BUDGETS).filter((b) => !b.monthKey || b.monthKey === key);
    const bills = getStorageData(KEYS.BILLS);
    const goals = getStorageData(KEYS.SAVINGS_GOALS);
    const txs = getStorageData(KEYS.TRANSACTIONS).filter((t) => monthKeyFromDate(t.date) === key);
    const savings = totals.savings;
    let score = 60;
    const insights = [];
    if (totals.income > 0)  {
        const spendRate = totals.expense / totals.income;
        if (spendRate <= .7) score += 15;
        else if (spendRate > 1) score -= 20;
        else if (spendRate > .9) score -= 8;
        const saveRate = savings / totals.income;
        if (saveRate >= .2) score += 10;
        else if (saveRate >= .1) score += 5;
        insights.push(`You saved ${Math.round(saveRate*100)}% of this month's income.`);
    }
    const today = toLocalISODate(new Date());
    const overdue = bills.filter((b)=>!b.paid && b.dueDate && b.dueDate < today).length;
    if (overdue)  {
        score -= Math.min(20, overdue*5);
        insights.push(`${overdue} bill${overdue===1?' is':'s are'} overdue.`);
    }
    let budgetPressure = 0;
    budgets.forEach((b) =>  {
        const used = txs.filter((t)=>t.type==='expense' && t.category===b.category).reduce((s,t)=>s+(Number(t.amount)||0),0);
        const pct = Number(b.limit) ? used/Number(b.limit) : 0;
        if (pct >= 1)  {
            score -= 6;
            budgetPressure++;
        } else if (pct >= .8) insights.push(`${b.category} budget is ${Math.round(pct*100)}% used.`);
    });
    if (!overdue && bills.length) score += 5;
    if (goals.some((g)=>g.type==='emergency' && Number(g.saved)>=Number(g.target))) score += 10;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs attention';
    const d = new Date();
    d.setMonth(d.getMonth()-1);
    const prevKey = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const prev = getMonthTotals(prevKey);
    if (prev.expense > 0)  {
        const diff = ((totals.expense-prev.expense)/prev.expense)*100;
        insights.unshift(`Spending is ${Math.abs(diff).toFixed(1)}% ${diff>=0?'higher':'lower'} than last month.`);
    }
    if (!insights.length) insights.push('Add income, expenses, budgets and bills to get personalized insights.');
    return  {
        score, label, insights: insights.slice(0,4)
    };
}
// --- Savings goal <-> transaction sync ---
// Contributions share the same id as their Dashboard transaction.
function savingsDescForGoal(goalName)  {
    return 'Daily Savings contribution for: ' + goalName;
}
function recalcGoalSaved(goal)  {
    const sum = (goal.contributions || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    goal.saved = sum;
    return goal;
}
function findGoalIndexForTx(goals, tx)  {
    if (!tx) return -1;
    const tid = tx.id;
    for (let i = 0; i < goals.length; i++)  {
        const g = goals[i];
        if ((g.contributions || []).some((c) => c.id === tid)) return i;
    }
    // Fallback: match by classic description
    if (tx.description && String(tx.description).startsWith('Daily Savings contribution for: '))  {
        const name = String(tx.description).slice('Daily Savings contribution for: '.length);
        return goals.findIndex((g) => g.name === name);
    }
    return -1;
}
/** Keep savings goals in sync after a transaction is updated on the Dashboard. */ function syncSavingsOnTxUpdate(oldTx, newTx)  {
    if (!oldTx && !newTx) return;
    const goals = getStorageData(KEYS.SAVINGS_GOALS);
    if (!Array.isArray(goals) || !goals.length) return;
    const wasSavings = oldTx && (oldTx.category === 'Savings Deposit' || (oldTx.description && String(oldTx.description).startsWith('Daily Savings contribution for: ')));
    const isSavings = newTx && newTx.type === 'expense' && newTx.category === 'Savings Deposit';
    let changed = false;
    // Case 1: was a savings deposit — update or remove linked contribution
    if (wasSavings && oldTx)  {
        const gi = findGoalIndexForTx(goals, oldTx);
        if (gi >= 0)  {
            const goal = goals[gi];
            if (!Array.isArray(goal.contributions)) goal.contributions = [];
            const ci = goal.contributions.findIndex((c) => c.id === oldTx.id);
            if (isSavings && newTx)  {
                // Still a savings deposit — update amount (and keep description tied to goal)
                if (ci >= 0)  {
                    goal.contributions[ci].amount = Number(newTx.amount) || 0;
                } else  {
                    goal.contributions.push({
                        id: newTx.id, amount: Number(newTx.amount) || 0, dateISO: (newTx.date && String(newTx.date).slice(0, 10)) || new Date().toISOString().slice(0, 10), dateLabel: newTx.date || new Date().toLocaleDateString()
                    });
                }
                // Force description to stay linked to this goal
                if (newTx) newTx.description = savingsDescForGoal(goal.name);
                recalcGoalSaved(goal);
                changed = true;
            } else  {
                // No longer a savings deposit — drop contribution
                if (ci >= 0)  {
                    goal.contributions.splice(ci, 1);
                    recalcGoalSaved(goal);
                    changed = true;
                }
            }
        }
    } else if (isSavings && newTx && !wasSavings)  {
        // Became a savings deposit but wasn't one — try attach by description goal name
        const desc = newTx.description || '';
        let goalName = null;
        if (desc.startsWith('Daily Savings contribution for: '))  {
            goalName = desc.slice('Daily Savings contribution for: '.length);
        }
        if (goalName)  {
            const gi = goals.findIndex((g) => g.name === goalName);
            if (gi >= 0)  {
                const goal = goals[gi];
                if (!Array.isArray(goal.contributions)) goal.contributions = [];
                if (!goal.contributions.some((c) => c.id === newTx.id))  {
                    goal.contributions.push({
                        id: newTx.id, amount: Number(newTx.amount) || 0, dateISO: (newTx.date && String(newTx.date).slice(0, 10)) || new Date().toISOString().slice(0, 10), dateLabel: newTx.date || new Date().toLocaleDateString()
                    });
                    recalcGoalSaved(goal);
                    changed = true;
                }
            }
        }
    }
    if (changed) setStorageData(KEYS.SAVINGS_GOALS, goals);
}
/** Keep savings goals in sync after a transaction is deleted on the Dashboard. */ function syncSavingsOnTxDelete(tx)  {
    if (!tx) return;
    const goals = getStorageData(KEYS.SAVINGS_GOALS);
    if (!Array.isArray(goals) || !goals.length) return;
    const gi = findGoalIndexForTx(goals, tx);
    if (gi < 0) return;
    const goal = goals[gi];
    if (!Array.isArray(goal.contributions)) return;
    const before = goal.contributions.length;
    goal.contributions = goal.contributions.filter((c) => c.id !== tx.id);
    if (goal.contributions.length === before)  {
        // fallback: match amount+description era without id
        if (tx.description === savingsDescForGoal(goal.name))  {
            const amt = Number(tx.amount) || 0;
            const idx = goal.contributions.findIndex((c) => Number(c.amount) === amt);
            if (idx >= 0) goal.contributions.splice(idx, 1);
        }
    }
    recalcGoalSaved(goal);
    setStorageData(KEYS.SAVINGS_GOALS, goals);
}
/** Update a contribution from the Savings page (edits matching Dashboard tx). */ function updateSavingsContribution(goalId, contribId, newAmount)  {
    const goals = getStorageData(KEYS.SAVINGS_GOALS);
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return  {
        ok: false, error: 'Goal not found.'
    };
    if (!Array.isArray(goal.contributions)) goal.contributions = [];
    const ci = goal.contributions.findIndex((c) => c.id === contribId);
    if (ci < 0) return  {
        ok: false, error: 'Contribution not found.'
    };
    const oldAmount = Number(goal.contributions[ci].amount) || 0;
    const amt = Number(newAmount) || 0;
    if (amt <= 0) return  {
        ok: false, error: 'Enter a valid amount.'
    };
    const others = goal.saved - oldAmount;
    if (others + amt > goal.target)  {
        const max = Math.max(0, goal.target - others);
        return  {
            ok: false, error: 'Amount too high. Max for this deposit: ' + formatMoney(max)
        };
    }
    goal.contributions[ci].amount = amt;
    recalcGoalSaved(goal);
    setStorageData(KEYS.SAVINGS_GOALS, goals);
    const transactions = getStorageData(KEYS.TRANSACTIONS);
    const ti = transactions.findIndex((t) => t.id === contribId);
    if (ti >= 0)  {
        transactions[ti].amount = amt;
        transactions[ti].category = 'Savings Deposit';
        transactions[ti].type = 'expense';
        transactions[ti].description = savingsDescForGoal(goal.name);
        setStorageData(KEYS.TRANSACTIONS, transactions);
    }
    return  {
        ok: true, goal
    };
}
/** Delete a contribution from the Savings page (also removes Dashboard tx). */ function deleteSavingsContribution(goalId, contribId)  {
    const goals = getStorageData(KEYS.SAVINGS_GOALS);
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return  {
        ok: false, error: 'Goal not found.'
    };
    if (!Array.isArray(goal.contributions)) goal.contributions = [];
    goal.contributions = goal.contributions.filter((c) => c.id !== contribId);
    recalcGoalSaved(goal);
    setStorageData(KEYS.SAVINGS_GOALS, goals);
    const transactions = getStorageData(KEYS.TRANSACTIONS);
    setStorageData( KEYS.TRANSACTIONS, transactions.filter((t) => t.id !== contribId) );
    return  {
        ok: true, goal
    };
}
// --- Reusable password visibility toggles -------------------------------
function initPasswordToggles()  {
    document.querySelectorAll('.password-field').forEach((wrap) =>  {
        const input = wrap.querySelector('input[type="password"], input[data-password-input]');
        const btn = wrap.querySelector('.password-toggle');
        if (!input || !btn || btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () =>  {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            btn.textContent = showing ? '👁' : '⊘';
            btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
            btn.setAttribute('aria-pressed', String(!showing));
        });
    });
}
document.addEventListener('DOMContentLoaded', initPasswordToggles);
// --- 4. Global UI Initialization ---
document.addEventListener('DOMContentLoaded', () =>  {
    initPasswordToggles();
    // Show loading skeleton until Firebase data is pulled
    if (!isLoginPage && !_appReady)  {
        document.body.classList.add('app-loading');
    }
    const currentTheme = localStorage.getItem('theme');
    const themeToggleBtn = document.getElementById('theme-toggle');
    function applyThemeIcon(isDark)  {
        if (!themeToggleBtn) return;
        themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
        themeToggleBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        themeToggleBtn.title = isDark ? 'Light Mode' : 'Dark Mode';
    }
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldDark = currentTheme === 'dark' || (currentTheme === 'system' && systemDark);
    document.body.classList.toggle('dark-mode', shouldDark);
    applyThemeIcon(shouldDark);
    if (themeToggleBtn)  {
        themeToggleBtn.addEventListener('click', () =>  {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            applyThemeIcon(isDark);
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
    function doLogout()  {
        auth.signOut().finally(() =>  {
            window.location.href = 'login.html';
        });
    }
    document.querySelectorAll('#logout-btn, .mobile-menu-logout, .btn-logout').forEach((btn) =>  {
        btn.addEventListener('click', doLogout);
    });
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const navLinks = document.getElementById('nav-links') || document.querySelector('.nav-links');
    if (hamburgerBtn && navLinks)  {
        hamburgerBtn.addEventListener('click', (e) =>  {
            e.stopPropagation();
            const isOpen = navLinks.classList.toggle('open');
            hamburgerBtn.classList.toggle('open', isOpen);
            hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
        navLinks.querySelectorAll('a.nav-link').forEach((link) =>  {
            link.addEventListener('click', () =>  {
                navLinks.classList.remove('open');
                hamburgerBtn.classList.remove('open');
                hamburgerBtn.setAttribute('aria-expanded', 'false');
            });
        });
        document.addEventListener('click', (e) =>  {
            if ( navLinks.classList.contains('open') && !navLinks.contains(e.target) && !hamburgerBtn.contains(e.target) )  {
                navLinks.classList.remove('open');
                hamburgerBtn.classList.remove('open');
                hamburgerBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }
    if ('Notification' in window && Notification.permission === 'default')  {
        // Soft prompt later from calendar page
    }
    onAppReady(() =>  {
        checkCalendarReminders();
        setInterval(checkCalendarReminders, 60 * 1000);
    });
});
function installSyncIndicator() {
    let el=document.getElementById('sync-status');
    if(!el) {
        el=document.createElement('div');
        el.id='sync-status';
        el.className='sync-badge';
        document.body.appendChild(el);
    }
    const update=()=> {
        if(!navigator.onLine) {
            el.textContent='Offline — changes will sync when connected';
            return;
        }
        const last=localStorage.getItem('smarttracker_last_sync');
        el.textContent=last?'☁️ Last synced: '+new Date(last).toLocaleTimeString([],  {
            hour:'2-digit',minute:'2-digit'
        }):'☁️ Online · Firebase sync active';
    };
    window.addEventListener('online',update);
    window.addEventListener('offline',update);
    update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSyncIndicator);
else installSyncIndicator();
function checkCalendarReminders()  {
    const events = getCalendarEvents();
    if (!events.length) return;
    const now = new Date();
    const notified = JSON.parse(sessionStorage.getItem('notified_events') || '[]');
    events.forEach((ev) =>  {
        if (!ev.date || !ev.time) return;
        const remindMin = Number(ev.remindMinutes) || 0;
        const when = new Date(`${ev.date}T${ev.time}:00`);
        if (isNaN(when.getTime())) return;
        const remindAt = new Date(when.getTime() - remindMin * 60 * 1000);
        const key = String(ev.id);
        if (now >= remindAt && now <= new Date(when.getTime() + 5 * 60 * 1000))  {
            if (notified.includes(key)) return;
            notified.push(key);
            sessionStorage.setItem('notified_events', JSON.stringify(notified));
            const title = ev.type === 'bill' ? 'Bill reminder' : 'Event reminder';
            const body = `${ev.title}${ev.description ? ' — ' + ev.description : ''} at ${ev.time}`;
            if ('Notification' in window && Notification.permission === 'granted')  {
                new Notification(title,  {
                    body, icon: 'images/logo 2.png'
                });
            }
            showInAppToast(`${title}: ${body}`);
        }
    });
}
function showInAppToast(message)  {
    let toast = document.getElementById('app-toast');
    if (!toast)  {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 6000);
}


// SmartTracker PWA service worker registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(error => console.warn('Service worker registration failed:', error));
    });
}
