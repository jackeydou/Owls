/** Copy for Remote Router: the device picker and Settings → Devices. */
export const remoteEn = {
  'remote.title': 'Devices',
  'remote.intro':
    'Use the Router on another Mac from here: messages go to that Mac, its workers run there with its agents, and the results show up here. Nothing is synced; each Mac keeps its own threads.',
  'remote.thisMacGroup': 'This Mac ({{name}})',
  'remote.otherGroup': 'Other devices',
  'remote.access': 'Let paired devices use this Mac',
  'remote.accessHelp':
    "Paired devices can message this Mac's Router and run workers here, with this Mac's agents and plan usage. Owlto must stay open, and the Mac awake.",
  'remote.addresses': 'Address',
  'remote.addressesHelp':
    'Type one of these on the other device. Same Wi-Fi works as is; from elsewhere, use the Tailscale address.',
  'remote.noAddress': 'No network connection',
  'remote.pair': 'Pair a device',
  'remote.pairHelp': 'Shows a one-time code to type on the other device.',
  'remote.pairStart': 'Show code',
  'remote.pairCodeLabel': 'Pairing code',
  'remote.pairExpires': 'Expires in {{time}}',
  'remote.pairCancel': 'Cancel',
  'remote.clients': 'Can use this Mac',
  'remote.clientsHelp': 'Remove a device to cut it off right away.',
  'remote.revoke': 'Remove',
  'remote.connected': 'Connected now',
  'remote.lastSeen': 'Last connected {{time}}',
  'remote.neverSeen': 'Not connected yet',
  'remote.add': 'Add a device',
  'remote.addHelp':
    'On the other Mac, open Settings → Devices, turn on access, and click Show code. Then enter its address and the code here.',
  'remote.addAddress': 'Address of the other Mac',
  'remote.addAddressPlaceholder': '192.168.1.20 or mac-mini.tail1234.ts.net',
  'remote.addCode': 'Pairing code',
  'remote.addCodePlaceholder': 'ABCD-EFGH',
  'remote.addSubmit': 'Pair',
  'remote.devices': 'Paired devices',
  'remote.devicesHelp': 'Pick one at the top of the sidebar to use its Router.',
  'remote.remove': 'Remove',
  'remote.status.online': 'Online',
  'remote.status.connecting': 'Connecting',
  'remote.status.offline': 'Offline',
  'remote.thisMac': 'This Mac',
  'remote.thisMacNamed': 'This Mac ({{name}})',
  'remote.pickerTitle': 'Show the Router on',
  'remote.pickerLabel': 'Device: {{device}}',
  'remote.manage': 'Manage devices…',
  'errors.remote_offline':
    'That device is not connected. Check that it is on, awake, and running Owlto.',
  'errors.remote_timeout': 'That device did not answer in time. Try again.',
  'errors.remote_unreachable':
    'Nothing answered at that address. Check the address, and that access is on in its Settings → Devices.',
  'errors.remote_pairing_failed':
    'The code did not work. Check it, or show a new code on the other Mac.',
  'errors.remote_identity_changed':
    'That device no longer recognizes this one, or its identity changed. Remove it and pair again.',
  'errors.remote_version': 'That device runs a different version of Owlto. Update both Macs.',
  'errors.remote_unsupported': 'This only works on the device itself.'
}

export const remoteZh: Record<keyof typeof remoteEn, string> = {
  'remote.title': '设备',
  'remote.intro':
    '在这里使用另一台 Mac 上的 Router：消息发到那台 Mac，Worker 在那里用它的 agent 运行，结果显示在这里。不会同步数据，每台 Mac 保留自己的 Thread。',
  'remote.thisMacGroup': '这台 Mac（{{name}}）',
  'remote.otherGroup': '其他设备',
  'remote.access': '允许已配对的设备使用这台 Mac',
  'remote.accessHelp':
    '已配对的设备可以给这台 Mac 的 Router 发消息，并在这里运行 Worker，使用这台 Mac 的 agent 和额度。需要保持 Owlto 打开、Mac 不睡眠。',
  'remote.addresses': '地址',
  'remote.addressesHelp':
    '在另一台设备上输入其中一个。同一个 Wi-Fi 下直接可用；在别处请用 Tailscale 地址。',
  'remote.noAddress': '没有网络连接',
  'remote.pair': '配对设备',
  'remote.pairHelp': '显示一个一次性的配对码，在另一台设备上输入。',
  'remote.pairStart': '显示配对码',
  'remote.pairCodeLabel': '配对码',
  'remote.pairExpires': '{{time}} 后失效',
  'remote.pairCancel': '取消',
  'remote.clients': '可以使用这台 Mac 的设备',
  'remote.clientsHelp': '移除设备后它会立即断开。',
  'remote.revoke': '移除',
  'remote.connected': '已连接',
  'remote.lastSeen': '上次连接：{{time}}',
  'remote.neverSeen': '还没有连接过',
  'remote.add': '添加设备',
  'remote.addHelp':
    '在另一台 Mac 上打开 设置 → 设备，打开访问开关并点「显示配对码」，然后在这里输入它的地址和配对码。',
  'remote.addAddress': '另一台 Mac 的地址',
  'remote.addAddressPlaceholder': '192.168.1.20 或 mac-mini.tail1234.ts.net',
  'remote.addCode': '配对码',
  'remote.addCodePlaceholder': 'ABCD-EFGH',
  'remote.addSubmit': '配对',
  'remote.devices': '已配对的设备',
  'remote.devicesHelp': '在侧边栏顶部选择设备，即可使用它的 Router。',
  'remote.remove': '移除',
  'remote.status.online': '在线',
  'remote.status.connecting': '连接中',
  'remote.status.offline': '离线',
  'remote.thisMac': '这台 Mac',
  'remote.thisMacNamed': '这台 Mac（{{name}}）',
  'remote.pickerTitle': '使用哪台设备的 Router',
  'remote.pickerLabel': '设备：{{device}}',
  'remote.manage': '管理设备…',
  'errors.remote_offline': '这台设备没有连接，请确认它已开机、没有睡眠，并且 Owlto 正在运行。',
  'errors.remote_timeout': '这台设备没有及时回应，请再试一次。',
  'errors.remote_unreachable':
    '这个地址没有回应。请检查地址，并确认对方在 设置 → 设备 里打开了访问。',
  'errors.remote_pairing_failed': '配对码不对。请检查，或在另一台 Mac 上重新显示配对码。',
  'errors.remote_identity_changed':
    '这台设备已不认识这台 Mac，或者它的身份变了。请移除后重新配对。',
  'errors.remote_version': '这台设备运行的 Owlto 版本不同，请把两台 Mac 都更新到最新版本。',
  'errors.remote_unsupported': '这个操作只能在那台设备上进行。'
}
