import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MenuList from '../components/MenuList.js';
import StaffList from '../components/StaffList.js';
import DateTimePicker from '../components/DateTimePicker.js';
import Confirm from '../components/Confirm.js';
import Done from '../components/Done.js';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';

type Step = 'menu' | 'staff' | 'datetime' | 'confirm' | 'done';

export default function Booking() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isPeek = params.get('mode') === 'peek';
  const directMenuId = params.get('menu_id');

  const [step, setStep] = useState<Step>('menu');
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<StaffItem | null>(null);
  const [slot, setSlot] = useState<{ date: string; start: string } | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string>('requested');

  useEffect(() => {
    if (!directMenuId) return;
    let cancelled = false;
    void api.menus().then(async ({ menus }) => {
      const directMenu = menus.find((item) => item.id === directMenuId);
      if (!directMenu || cancelled) return;
      setMenu(directMenu);
      const { staff: availableStaff } = await api.staffOf(directMenu.id);
      if (cancelled) return;
      if (availableStaff.length === 1) {
        setStaff(availableStaff[0]);
        setStep('datetime');
      } else {
        setStep('staff');
      }
    }).catch(() => {
      // 専用URLが古い場合は通常のメニュー一覧を表示する。
    });
    return () => { cancelled = true; };
  }, [directMenuId]);

  function exitPeekToBooking() {
    // peek モードを抜けて通常フローへ。同じ menu/staff/slot を持ち回したまま step を進める。
    const next = new URLSearchParams(params);
    next.delete('mode');
    navigate({ pathname: '/booking', search: next.toString() }, { replace: true });
    setStep('confirm');
  }

  return (
    <div className="max-w-md mx-auto p-4 pb-12 min-h-screen">
      {step === 'menu' && (
        <MenuList
          onSelect={(m) => {
            setMenu(m);
            setStep('staff');
          }}
        />
      )}
      {step === 'staff' && menu && (
        <StaffList
          menuId={menu.id}
          basePrice={menu.base_price}
          onSelect={(s) => {
            setStaff(s);
            setStep('datetime');
          }}
          onBack={() => setStep('menu')}
        />
      )}
      {step === 'datetime' && menu && staff && (
        <DateTimePicker
          menuId={menu.id}
          staffId={staff.id}
          ctaLabel={
            isPeek ? '空き状況の確認モードです' : '確認画面で要望を入力してください'
          }
          onSelect={(picked) => {
            setSlot(picked);
            if (isPeek) {
              // peek モードでは確認画面に進めず、ここでクッションを挟む。
              // 「予約に進む」ボタンを画面下部に表示するため、step を datetime に保持。
            } else {
              setStep('confirm');
            }
          }}
          onBack={() => setStep('staff')}
        />
      )}
      {step === 'datetime' && isPeek && slot && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
          <p className="text-sm text-gray-600 mb-2">
            選択中: {slot.date} {slot.start}
          </p>
          <button
            onClick={exitPeekToBooking}
            className="w-full bg-green-600 text-white py-3 rounded font-semibold"
          >
            この時間で予約に進む
          </button>
        </div>
      )}
      {step === 'confirm' && menu && staff && slot && (
        <Confirm
          menu={menu}
          staff={staff}
          slot={slot}
          onSubmitted={(status) => {
            setBookingStatus(status);
            setStep('done');
          }}
          onBack={() => setStep('datetime')}
        />
      )}
      {step === 'done' && <Done confirmed={bookingStatus === 'confirmed'} />}
    </div>
  );
}
