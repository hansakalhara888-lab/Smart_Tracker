onAppReady(() =>  {
    // If Firebase says we're logged in but profile is missing from cache/cloud,
    // build a default profile instead of bouncing away.
    let profile = getUserProfile();
    if (!profile)  {
        const user = typeof auth !== 'undefined' ? auth.currentUser : null;
        let username = 'user';
        if (user && user.email)  {
            username = user.email.split('@')[0] || 'user';
        }
        profile =  {
            username: username, fullname: '', age: '', dob: '', job: '', country: '', phone: '', currency: 'LKR', photo: null
        };
        saveUserProfile(profile);
    }
    const photoPreview = document.getElementById('profile-photo-preview');
    const photoPlaceholder = document.getElementById('profile-photo-placeholder');
    const photoInput = document.getElementById('profile-photo-input');
    const form = document.getElementById('account-form');
    const saveMsg = document.getElementById('account-save-msg');
    function showMsg(el, text, type)  {
        if (!el) return;
        el.style.display = 'block';
        el.textContent = text;
        el.className = 'save-msg ' + (type || 'success');
    }
    function hideMsg(el)  {
        if (!el) return;
        el.style.display = 'none';
    }
    function usernameToEmail(username)  {
        return String(username || '').trim().toLowerCase() + '@moneytracker.local';
    }
    function currentEmail()  {
        const user = auth.currentUser;
        if (user && user.email) return user.email;
        const p = getUserProfile();
        if (p && p.username) return usernameToEmail(p.username);
        return null;
    }
    function friendlyAuthError(err)  {
        const code = err && err.code;
        switch (code)  {
            case 'auth/wrong-password': case 'auth/invalid-credential': return 'Current password is incorrect.';
            case 'auth/weak-password': return 'New password must be at least 6 characters.';
            case 'auth/requires-recent-login': return 'For security, please log out, log in again, then retry.';
            case 'auth/too-many-requests': return 'Too many attempts. Please try again later.';
            case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
            default: return (err && err.message) || 'Something went wrong. Please try again.';
        }
    }
    async function reauthenticate(password)  {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in.');
        const email = currentEmail();
        if (!email) throw new Error('Could not determine account email.');
        const credential = firebase.auth.EmailAuthProvider.credential(email, password);
        await user.reauthenticateWithCredential(credential);
        return user;
    }
    function showPhoto(dataUrl)  {
        if (dataUrl)  {
            photoPreview.src = dataUrl;
            photoPreview.style.display = 'block';
            photoPlaceholder.style.display = 'none';
        } else  {
            photoPreview.src = '';
            photoPreview.style.display = 'none';
            photoPlaceholder.style.display = 'flex';
        }
    }
    document.getElementById('account-display-name').textContent = profile.fullname || profile.username || 'My Account';
    document.getElementById('account-username').textContent = '@' + (profile.username || '');
    document.getElementById('acc-username').value = profile.username || '';
    document.getElementById('acc-fullname').value = profile.fullname || '';
    const accountEmailEl = document.getElementById('acc-email');
    if (accountEmailEl) accountEmailEl.value = (auth.currentUser && auth.currentUser.email) || profile.email || '';
    document.getElementById('acc-age').value = profile.age || '';
    document.getElementById('acc-dob').value = profile.dob || '';
    document.getElementById('acc-job').value = profile.job || '';
    document.getElementById('acc-country').value = profile.country || '';
    document.getElementById('acc-phone').value = profile.phone || '';
    document.getElementById('acc-currency').value = profile.currency || 'LKR';
    if(document.getElementById('acc-theme')) document.getElementById('acc-theme').value = profile.theme || localStorage.getItem('theme') || 'system';
    if(document.getElementById('acc-date-format')) document.getElementById('acc-date-format').value = profile.dateFormat || 'DD/MM/YYYY';
    showPhoto(profile.photo || null);
    // Age <-> Birthday on Account page
    function calcAgeFromDob(dobStr)  {
        if (!dobStr) return '';
        const dob = new Date(dobStr + 'T00:00:00');
        if (isNaN(dob.getTime())) return '';
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
        return age >= 0 ? String(age) : '';
    }
    function calcDobFromAge(ageStr, existingDob)  {
        const age = parseInt(ageStr, 10);
        if (isNaN(age) || age < 0 || age > 120) return '';
        const year = new Date().getFullYear() - age;
        // Do not invent a month/day. Preserve what the user already entered.
        if (!existingDob || !/^\d{4}-\d{2}-\d{2}$/.test(existingDob)) return '';
        return String(year) + existingDob.slice(4);
    }
    const accAge = document.getElementById('acc-age');
    const accDob = document.getElementById('acc-dob');
    let syncingAgeDob = false;
    if (accAge)  {
        accAge.addEventListener('input', () =>  {
            if (syncingAgeDob) return;
            const dob = calcDobFromAge(accAge.value.trim(), accDob.value);
            if (!dob || !accDob) return;
            syncingAgeDob = true;
            accDob.value = dob;
            syncingAgeDob = false;
        });
    }
    if (accDob)  {
        const onDob = () =>  {
            if (syncingAgeDob) return;
            const age = calcAgeFromDob(accDob.value);
            if (age === '' || !accAge) return;
            syncingAgeDob = true;
            accAge.value = age;
            syncingAgeDob = false;
        };
        accDob.addEventListener('change', onDob);
        accDob.addEventListener('input', onDob);
    }
    photoInput.addEventListener('change' , () =>  {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        if (file.size > 800 * 1024)  {
            alert('Please choose a photo smaller than 800 KB.');
            photoInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () =>  {
            const img = new Image();
            img.onload = () =>  {
                const max = 320;
                let w = img.width;
                let h = img.height;
                if (w > max || h > max)  {
                    const scale = Math.min(max / w, max / h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                showPhoto(dataUrl);
                photoPreview.dataset.pending = dataUrl;
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
    form.addEventListener('submit', (e) =>  {
        e.preventDefault();
        const current = getUserProfile() || profile;
        const updated = Object.assign({
        }, current,  {
            username: document.getElementById('acc-username').value.trim() || current.username, fullname: document.getElementById('acc-fullname').value.trim(), email: (auth.currentUser && auth.currentUser.email) || current.email || '', age: (function() {
                var d=document.getElementById('acc-dob').value;
                var a=document.getElementById('acc-age').value.trim();
                if(d) {
                    var x=calcAgeFromDob(d);
                    if(x) return x;
                }
                return a;
            })(), dob: document.getElementById('acc-dob').value, job: document.getElementById('acc-job').value.trim(), country: document.getElementById('acc-country').value.trim(), phone: document.getElementById('acc-phone').value.trim(), currency: document.getElementById('acc-currency').value, theme: document.getElementById('acc-theme') ? document.getElementById('acc-theme').value : 'system', dateFormat: document.getElementById('acc-date-format') ? document.getElementById('acc-date-format').value : 'DD/MM/YYYY'
        });
        if (photoPreview.dataset.pending)  {
            updated.photo = photoPreview.dataset.pending;
            delete photoPreview.dataset.pending;
        }
        saveUserProfile(updated);
        localStorage.setItem('theme', updated.theme || 'system');
        const wantsDark = updated.theme==='dark' || (updated.theme==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.body.classList.toggle('dark-mode', wantsDark);
        document.getElementById('account-display-name').textContent = updated.fullname || updated.username || 'My Account';
        document.getElementById('account-username').textContent = '@' + (updated.username || '');
        showMsg(saveMsg, '✓ Profile saved. Currency will apply across the app.', 'success');
        setTimeout(() => hideMsg(saveMsg), 3500);
    });
    // ---- Change password (Firebase Auth) ----
    const passwordForm = document.getElementById('password-form');
    const passwordMsg = document.getElementById('password-msg');
    if (passwordForm)  {
        passwordForm.addEventListener('submit', async (e) =>  {
            e.preventDefault();
            hideMsg(passwordMsg);
            const cur = document.getElementById('cur-password').value;
            const neu = document.getElementById('new-password').value;
            const conf = document.getElementById('confirm-password').value;
            const btn = passwordForm.querySelector('button[type="submit"]');
            if (neu.length < 6)  {
                showMsg(passwordMsg, 'New password must be at least 6 characters.', 'error');
                return;
            }
            if (neu !== conf)  {
                showMsg(passwordMsg, 'New passwords do not match.', 'error');
                return;
            }
            if (cur === neu)  {
                showMsg(passwordMsg, 'New password must be different from the current one.', 'error');
                return;
            }
            if (btn) btn.disabled = true;
            try  {
                const user = await reauthenticate(cur);
                await user.updatePassword(neu);
                passwordForm.reset();
                showMsg(passwordMsg, '✓ Password updated successfully.', 'success');
                setTimeout(() => hideMsg(passwordMsg), 4000);
            } catch (err)  {
                console.error(err);
                showMsg(passwordMsg, friendlyAuthError(err), 'error');
            } finally  {
                if (btn) btn.disabled = false;
            }
        });
    }
    // ---- Delete account (Firebase Auth + Firestore + local cache) ----
    const deleteBtn = document.getElementById('delete-account-btn');
    const deleteMsg = document.getElementById('delete-msg');
    if (deleteBtn)  {
        deleteBtn.addEventListener('click', async () =>  {
            hideMsg(deleteMsg);
            const pwd = document.getElementById('delete-password').value;
            if (!pwd)  {
                showMsg(deleteMsg, 'Enter your password to confirm deletion.', 'error');
                return;
            }
            const ok = confirm( 'Delete your account permanently?\n\nAll transactions, savings goals, calendar events, and reports will be removed. This cannot be undone.' );
            if (!ok) return;
            deleteBtn.disabled = true;
            try  {
                const user = await reauthenticate(pwd);
                const uid = user.uid;
                // Delete cloud document first (best effort)
                try  {
                    await db.collection('users').doc(uid).delete();
                } catch (cloudErr)  {
                    console.error('Firestore delete failed:', cloudErr);
                }
                // Clear local cache
                Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
                localStorage.removeItem('theme');
                sessionStorage.clear();
                // Delete Auth user (must be after recent reauth)
                await user.delete();
                alert('Your account has been deleted.');
                window.location.href = 'login.html';
            } catch (err)  {
                console.error(err);
                showMsg(deleteMsg, friendlyAuthError(err), 'error');
                deleteBtn.disabled = false;
            }
        });
    }
});
