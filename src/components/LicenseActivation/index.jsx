import React, { useState, useEffect, useRef } from 'react';
import { Key, Mail, ShieldCheck, Ticket, AlertCircle, Sparkles, QrCode, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Input } from '../ui/input';
import './LicenseActivation.css';

const API_BASE = import.meta.env.VITE_LICENSE_SERVER_URL || 'https://video-dubber-khmer-v1.fastapicloud.dev';

export default function LicenseActivation({ onActivated }) {
  const [step, setStep] = useState(() => {
    const stored = localStorage.getItem('kvd_buy_step');
    if (stored === 'buy-verify') {
      const expiry = localStorage.getItem('kvd_timer_otp_expiry');
      if (!expiry || Date.now() >= parseInt(expiry, 10)) {
        return 'buy-email';
      }
    }
    if (stored === 'buy-pay') {
      const expiry = localStorage.getItem('kvd_timer_qr_expiry');
      if (!expiry || Date.now() >= parseInt(expiry, 10)) {
        return 'buy-plan';
      }
    }
    return stored || 'activate';
  });
  const [licenseKey, setLicenseKey] = useState('');
  const [email, setEmail] = useState(() => localStorage.getItem('kvd_buy_email') || '');
  const [otpCode, setOtpCode] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('monthly');
  const [discountCode, setDiscountCode] = useState('');
  const [verificationToken, setVerificationToken] = useState(() => localStorage.getItem('kvd_buy_verification_token') || '');
  
  // Checkout & Payment Details
  const [checkoutData, setCheckoutData] = useState(() => {
    const stored = localStorage.getItem('kvd_buy_checkout_data');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });
  
  // Timers & Cooldowns
  const [otpTimer, setOtpTimer] = useState(() => {
    const expiry = localStorage.getItem('kvd_timer_otp_expiry');
    if (!expiry) return 0;
    return Math.max(0, Math.floor((parseInt(expiry, 10) - Date.now()) / 1000));
  });
  const [resendTimer, setResendTimer] = useState(() => {
    const expiry = localStorage.getItem('kvd_timer_resend_expiry');
    if (!expiry) return 0;
    return Math.max(0, Math.floor((parseInt(expiry, 10) - Date.now()) / 1000));
  });
  const [qrTimer, setQrTimer] = useState(() => {
    const expiry = localStorage.getItem('kvd_timer_qr_expiry');
    if (!expiry) return 0;
    return Math.max(0, Math.floor((parseInt(expiry, 10) - Date.now()) / 1000));
  });
  
  // Global States
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const statusPollRef = useRef(null);

  const clearPersistenceState = () => {
    localStorage.removeItem('kvd_buy_step');
    localStorage.removeItem('kvd_buy_email');
    localStorage.removeItem('kvd_buy_verification_token');
    localStorage.removeItem('kvd_buy_checkout_data');
    localStorage.removeItem('kvd_timer_otp_expiry');
    localStorage.removeItem('kvd_timer_resend_expiry');
    localStorage.removeItem('kvd_timer_qr_expiry');
  };

  // On Mount: Resume payment status polling if in pay step
  useEffect(() => {
    if (step === 'buy-pay' && checkoutData) {
      startPollingPayment(checkoutData.reference_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    if (step) localStorage.setItem('kvd_buy_step', step);
  }, [step]);

  useEffect(() => {
    if (email) localStorage.setItem('kvd_buy_email', email);
  }, [email]);

  useEffect(() => {
    if (verificationToken) localStorage.setItem('kvd_buy_verification_token', verificationToken);
  }, [verificationToken]);

  useEffect(() => {
    if (checkoutData) {
      localStorage.setItem('kvd_buy_checkout_data', JSON.stringify(checkoutData));
    } else {
      localStorage.removeItem('kvd_buy_checkout_data');
    }
  }, [checkoutData]);

  // Load / initialize Device ID and Device Name
  const getDeviceInfo = async () => {
    let deviceId = localStorage.getItem('kvd_device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('kvd_device_id', deviceId);
    }
    
    let deviceName = 'Desktop';
    if (window.electron && typeof window.electron.getHostname === 'function') {
      try {
        deviceName = await window.electron.getHostname();
      } catch (e) {
        console.error('Failed to get hostname', e);
      }
    }
    return { deviceId, deviceName };
  };

  // OTP Resend/Expiry Timer loops
  useEffect(() => {
    let interval;
    if (otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpTimer]);

  useEffect(() => {
    let interval;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  // QR Expiry Timer loop
  useEffect(() => {
    let interval;
    if (qrTimer > 0 && step === 'buy-pay') {
      interval = setInterval(() => {
        setQrTimer(prev => {
          if (prev <= 1) {
            setError('Payment QR code expired. Please start over.');
            setStep('buy-plan');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [qrTimer, step]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, []);

  // Format seconds to MM:SS
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // 1. Activate Existing License
  const handleActivate = async (e) => {
    if (e) e.preventDefault();
    if (!licenseKey.trim()) {
      setError('Please enter a license key.');
      return;
    }
    setError('');
    setIsValidating(true);
    
    try {
      const { deviceId, deviceName } = await getDeviceInfo();
      const res = await fetch(`${API_BASE}/v1/licenses/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_key: licenseKey.trim().toUpperCase(),
          device_id: deviceId,
          device_name: deviceName
        })
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Activation failed.');
      }
      
      // Save details locally
      localStorage.setItem('kvd_activation_token', data.activation_token);
      localStorage.setItem('kvd_license_key', licenseKey.trim().toUpperCase());
      clearPersistenceState();
      setSuccess('License activated successfully! Welcome to Khmer Dubber!');
      
      setTimeout(() => {
        onActivated();
      }, 2000);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // 2. Request OTP Email
  const handleRequestOtp = async (e) => {
    if (e) e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid Gmail address.');
      return;
    }
    setError('');
    setIsValidating(true);
    
    try {
      const res = await fetch(`${API_BASE}/v1/auth/email-otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to send verification code.');
      }
      
      setSuccess('Verification code sent to your email.');
      setStep('buy-verify');
      const otpExpiryTime = Date.now() + 300 * 1000;
      const resendExpiryTime = Date.now() + 60 * 1000;
      setOtpTimer(300);
      setResendTimer(60);
      localStorage.setItem('kvd_timer_otp_expiry', otpExpiryTime.toString());
      localStorage.setItem('kvd_timer_resend_expiry', resendExpiryTime.toString());
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // 3. Verify OTP Code
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (!otpCode.trim() || otpCode.length !== 6) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }
    setError('');
    setIsValidating(true);
    
    try {
      const res = await fetch(`${API_BASE}/v1/auth/email-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: otpCode.trim()
        })
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'OTP verification failed.');
      }
      
      setVerificationToken(data.email_verification_token);
      setSuccess('Email verified successfully!');
      setTimeout(() => {
        setSuccess('');
        setStep('buy-plan');
      }, 1500);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // 4. Create Checkout (Plans list)
  const handleCreateCheckout = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setIsValidating(true);
    
    try {
      const res = await fetch(`${API_BASE}/v1/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          email_verification_token: verificationToken,
          plan: selectedPlan,
          discount_code: discountCode.trim() || null
        })
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate checkout.');
      }
      
      setCheckoutData(data);
      setStep('buy-pay');
      const qrExpiryTime = Date.now() + 300 * 1000;
      setQrTimer(300);
      localStorage.setItem('kvd_timer_qr_expiry', qrExpiryTime.toString());
      
      // Start polling payment status on backend
      startPollingPayment(data.reference_id);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // 5. Polling status check loop
  const startPollingPayment = (referenceId) => {
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    
    statusPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/payments/${referenceId}/status`);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.status === 'paid') {
            clearInterval(statusPollRef.current);
            setSuccess('Payment Confirmed! Your license key has been sent to your Gmail. Please copy it and paste it below.');
            setStep('activate');
            clearPersistenceState();
          }
        }
      } catch (e) {
        console.error('Error checking payment status', e);
      }
    }, 5000); // Poll every 5 seconds
  };

  return (
    <div className="activation-container">
      <div className="activation-card">
        <div className="activation-header">
          <h1 className="activation-logo-text">Khmer Dubber</h1>
          <p className="activation-subtitle">Fast, AI-powered Khmer video translation & dubbing</p>
        </div>

        {error && (
          <div className="activation-alert alert-error" style={{ marginBottom: '20px' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="activation-alert alert-success" style={{ marginBottom: '20px' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{success}</span>
          </div>
        )}

        {/* STEP 1: ACTIVATE LICENSE */}
        {step === 'activate' && (
          <form className="activation-form" onSubmit={handleActivate}>
            <div className="activation-step-title flex items-center gap-2">
              <ShieldCheck size={16} className="text-blue-500" />
              <span>License Key Activation</span>
            </div>

            <div className="form-group">
              <label className="form-label">Enter License Key</label>
              <div className="form-input-container">
                <Input
                  type="text"
                  placeholder="KVD-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  disabled={isValidating}
                  className="pr-10"
                />
                <Key size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full flex items-center justify-center gap-2"
              disabled={isValidating}
            >
              {isValidating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Validating...</span>
                </>
              ) : (
                <span>Activate Software</span>
              )}
            </button>

            <div className="activation-footer-link">
              <span>Don't have a license key? </span>
              <span className="footer-link" onClick={() => { setError(''); setSuccess(''); setStep('buy-email'); }}>
                Buy License Key
              </span>
            </div>
          </form>
        )}

        {/* STEP 2: BUY - INPUT EMAIL */}
        {step === 'buy-email' && (
          <form className="activation-form" onSubmit={handleRequestOtp}>
            <div className="activation-step-title flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              <span>Purchase - Step 1: Email Verification</span>
            </div>

            <div className="form-group">
              <label className="form-label">Gmail Address</label>
              <div className="form-input-container">
                <Input
                  type="email"
                  placeholder="your-name@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isValidating}
                  className="pr-10"
                />
                <Mail size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => { setError(''); setSuccess(''); setStep('activate'); clearPersistenceState(); }}
                disabled={isValidating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={isValidating}
              >
                {isValidating ? <RefreshCw size={14} className="animate-spin" /> : null}
                <span>Send Code</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: BUY - VERIFY OTP */}
        {step === 'buy-verify' && (
          <form className="activation-form" onSubmit={handleVerifyOtp}>
            <div className="activation-step-title flex items-center gap-2">
              <ShieldCheck size={16} className="text-purple-400" />
              <span>Purchase - Step 2: Verification Code</span>
            </div>

            <div className="form-group">
              <label className="form-label">Enter 6-digit Code sent to {email}</label>
              <div className="form-input-container">
                <Input
                  type="text"
                  placeholder="000000"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  disabled={isValidating}
                  className="pr-10 text-center tracking-widest font-mono text-base"
                />
              </div>
            </div>

            {otpTimer > 0 && (
              <p className="cooldown-text">
                Code expires in: <span className="font-semibold text-white">{formatTime(otpTimer)}</span>
              </p>
            )}

            {resendTimer > 0 ? (
              <p className="cooldown-text mt-0">
                Resend code in: <span className="font-semibold text-white">{resendTimer}s</span>
              </p>
            ) : (
              <p className="cooldown-text mt-0">
                Didn't get the code? <span className="cooldown-link" onClick={handleRequestOtp}>Resend Email</span>
              </p>
            )}

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => { setError(''); setSuccess(''); setStep('buy-email'); }}
                disabled={isValidating}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={isValidating}
              >
                {isValidating ? <RefreshCw size={14} className="animate-spin" /> : null}
                <span>Verify Code</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: BUY - SELECT PLAN */}
        {step === 'buy-plan' && (
          <form className="activation-form" onSubmit={handleCreateCheckout}>
            <div className="activation-step-title flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              <span>Purchase - Step 3: Choose Plan</span>
            </div>

            <div className="plan-grid">
              <div
                className={`plan-card ${selectedPlan === 'monthly' ? 'selected' : ''}`}
                onClick={() => setSelectedPlan('monthly')}
              >
                <div>
                  <h3 className="plan-title">Monthly Access</h3>
                  <span className="plan-duration">Valid for 31 days</span>
                </div>
                <div className="plan-price">$11.99</div>
              </div>

              <div
                className={`plan-card ${selectedPlan === 'six_months' ? 'selected' : ''}`}
                onClick={() => setSelectedPlan('six_months')}
              >
                <div>
                  <h3 className="plan-title">6 Months Access</h3>
                  <span className="plan-duration">Valid for 183 days</span>
                </div>
                <div className="plan-price">$59.99</div>
              </div>

              <div
                className={`plan-card ${selectedPlan === 'yearly' ? 'selected' : ''}`}
                onClick={() => setSelectedPlan('yearly')}
              >
                <div>
                  <h3 className="plan-title">Yearly Access</h3>
                  <span className="plan-duration">Valid for 366 days</span>
                </div>
                <div className="plan-price">$99.99</div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Promo Code (Optional)</label>
              <div className="form-input-container">
                <Input
                  type="text"
                  placeholder="PROMO10"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                  disabled={isValidating}
                  className="pr-10"
                />
                <Ticket size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => { setError(''); setSuccess(''); setStep('buy-verify'); }}
                disabled={isValidating}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={isValidating}
              >
                {isValidating ? <RefreshCw size={14} className="animate-spin" /> : null}
                <span>Get QR Code</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 5: BUY - SHOW QR AND POLL */}
        {step === 'buy-pay' && checkoutData && (
          <div className="activation-form">
            <div className="activation-step-title flex items-center gap-2">
              <QrCode size={16} className="text-emerald-400" />
              <span>Purchase - Step 4: Scan Bakong KHQR</span>
            </div>

            <div className="qr-container">
              {checkoutData.qr_string ? (
                <div className="qr-image-wrapper">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkoutData.qr_string)}`}
                    alt="Bakong KHQR code"
                    className="qr-image"
                  />
                </div>
              ) : (
                <div className="qr-image-wrapper" style={{ width: '200px', height: '200px', background: '#1e293b' }}>
                  <span className="text-xs text-gray-400">Loading QR...</span>
                </div>
              )}

              <div className="qr-meta">
                <span>Please scan this QR with your Bakong or KHQR banking app to complete checkout.</span>
                <div className="qr-amount">${parseFloat(checkoutData.amount).toFixed(2)}</div>
                {checkoutData.discount_code && (
                  <div className="text-xs text-emerald-400 mt-1">
                    Applied Code: {checkoutData.discount_code} (-${parseFloat(checkoutData.discount_amount).toFixed(2)})
                  </div>
                )}
              </div>
            </div>

            <div className="activation-alert alert-info flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-blue-400" style={{ flexShrink: 0 }} />
              <span>Listening for payment webhook. Checking status...</span>
            </div>

            <p className="cooldown-text text-center">
              QR expires in: <span className="font-semibold text-white">{formatTime(qrTimer)}</span>
            </p>

            <button
              className="btn btn-secondary w-full flex items-center justify-center gap-2"
              onClick={() => {
                if (statusPollRef.current) clearInterval(statusPollRef.current);
                setError('');
                setSuccess('');
                setStep('buy-plan');
              }}
            >
              <ArrowLeft size={14} />
              <span>Cancel Payment</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
