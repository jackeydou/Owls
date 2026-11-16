/** The emoji groups the project icon picker shows, in order. */
export type EmojiGroup =
  | 'work'
  | 'tech'
  | 'places'
  | 'nature'
  | 'animals'
  | 'food'
  | 'fun'
  | 'symbols'

/**
 * The emoji the project icon picker offers, grouped, each with English and Chinese search
 * words. A search that matches none of them can still be picked as typed.
 */
export const PROJECT_EMOJI: readonly {
  group: EmojiGroup
  emoji: readonly (readonly [emoji: string, words: string])[]
}[] = [
  {
    group: 'work',
    emoji: [
      ['📁', 'folder files 文件夹'],
      ['📂', 'folder open 文件夹'],
      ['🗂️', 'dividers index 分类'],
      ['📦', 'package box 包 盒子'],
      ['🧰', 'toolbox tools 工具箱'],
      ['🛠️', 'tools hammer wrench 工具'],
      ['⚙️', 'gear settings 齿轮 设置'],
      ['🔧', 'wrench fix 扳手'],
      ['🔩', 'bolt nut 螺丝'],
      ['📝', 'note memo write 笔记'],
      ['📄', 'document page 文档'],
      ['📚', 'books docs library 书'],
      ['📖', 'book read 书'],
      ['📰', 'news paper 新闻'],
      ['📊', 'chart bar stats 图表'],
      ['📈', 'chart up growth 增长'],
      ['📉', 'chart down 下降'],
      ['🧮', 'abacus math 算盘'],
      ['💼', 'briefcase work 公文包 工作'],
      ['📅', 'calendar date 日历'],
      ['⏰', 'alarm clock time 闹钟'],
      ['⏳', 'hourglass wait 沙漏'],
      ['✉️', 'mail email letter 邮件'],
      ['📮', 'mailbox post 邮筒'],
      ['💬', 'chat message 聊天'],
      ['📣', 'megaphone announce 喇叭'],
      ['🔔', 'bell notify 铃铛 通知'],
      ['💰', 'money bag 钱'],
      ['💳', 'card payment 信用卡 支付'],
      ['🛒', 'cart shopping 购物车'],
      ['✏️', 'pencil edit 铅笔'],
      ['📐', 'ruler triangle design 尺子']
    ]
  },
  {
    group: 'tech',
    emoji: [
      ['💻', 'laptop computer code 电脑'],
      ['🖥️', 'desktop computer screen 电脑'],
      ['📱', 'phone mobile app 手机'],
      ['⌨️', 'keyboard 键盘'],
      ['🖱️', 'mouse 鼠标'],
      ['🖨️', 'printer 打印机'],
      ['💾', 'disk save floppy 软盘 保存'],
      ['🗄️', 'cabinet archive 档案'],
      ['🔌', 'plug plugin 插头 插件'],
      ['🔋', 'battery 电池'],
      ['📡', 'antenna signal 天线'],
      ['🛰️', 'satellite space 卫星'],
      ['🤖', 'robot bot ai 机器人'],
      ['🧠', 'brain ai think 大脑'],
      ['💡', 'idea light bulb 想法 灯泡'],
      ['🧪', 'test lab experiment 实验'],
      ['🔬', 'microscope science research 显微镜'],
      ['🧬', 'dna biology 基因'],
      ['🚀', 'rocket launch ship 火箭'],
      ['🛸', 'ufo space 飞碟'],
      ['🔒', 'lock security 锁 安全'],
      ['🔑', 'key 钥匙'],
      ['🛡️', 'shield security 盾牌 安全'],
      ['🐛', 'bug 虫子'],
      ['🔗', 'link chain 链接'],
      ['🧲', 'magnet 磁铁'],
      ['🌐', 'web internet globe 网络'],
      ['🧩', 'puzzle piece plugin 拼图']
    ]
  },
  {
    group: 'places',
    emoji: [
      ['🌍', 'globe world earth africa 地球'],
      ['🌎', 'globe world earth americas 地球'],
      ['🌏', 'globe world earth asia 地球'],
      ['🗺️', 'map 地图'],
      ['🧭', 'compass navigation 指南针'],
      ['📍', 'pin location 定位'],
      ['🏠', 'home house 家 房子'],
      ['🏢', 'office building company 办公楼 公司'],
      ['🏦', 'bank finance 银行'],
      ['🏪', 'store shop 商店'],
      ['🏫', 'school 学校'],
      ['🏥', 'hospital health 医院'],
      ['🏗️', 'construction build 施工'],
      ['🏛️', 'museum classic 博物馆'],
      ['🏰', 'castle 城堡'],
      ['⛺', 'tent camp 帐篷'],
      ['🏝️', 'island beach 岛'],
      ['🏔️', 'mountain 山'],
      ['🚗', 'car 汽车'],
      ['🚲', 'bike 自行车'],
      ['✈️', 'plane travel 飞机'],
      ['🚢', 'ship 轮船'],
      ['⛵', 'sailboat 帆船'],
      ['⚓', 'anchor 锚']
    ]
  },
  {
    group: 'nature',
    emoji: [
      ['☀️', 'sun 太阳'],
      ['🌙', 'moon night 月亮'],
      ['⭐', 'star 星星'],
      ['☁️', 'cloud 云'],
      ['🌈', 'rainbow 彩虹'],
      ['❄️', 'snow 雪花'],
      ['🔥', 'fire hot 火'],
      ['⚡', 'lightning fast 闪电'],
      ['💧', 'water drop 水滴'],
      ['🌊', 'wave ocean 海浪'],
      ['🌱', 'seedling plant grow 幼苗'],
      ['🌿', 'herb leaf 叶子'],
      ['🍀', 'clover luck 四叶草'],
      ['🍁', 'maple leaf 枫叶'],
      ['🌲', 'tree forest 树'],
      ['🌵', 'cactus 仙人掌'],
      ['🌸', 'flower blossom 花'],
      ['🌻', 'sunflower 向日葵'],
      ['🌹', 'rose 玫瑰'],
      ['🍄', 'mushroom 蘑菇'],
      ['🪐', 'planet saturn 行星'],
      ['🌋', 'volcano 火山']
    ]
  },
  {
    group: 'animals',
    emoji: [
      ['🦉', 'owl 猫头鹰'],
      ['🐱', 'cat 猫'],
      ['🐶', 'dog 狗'],
      ['🦊', 'fox 狐狸'],
      ['🐼', 'panda 熊猫'],
      ['🐨', 'koala 考拉'],
      ['🐯', 'tiger 老虎'],
      ['🦁', 'lion 狮子'],
      ['🐸', 'frog 青蛙'],
      ['🐧', 'penguin 企鹅'],
      ['🐦', 'bird 鸟'],
      ['🦅', 'eagle 鹰'],
      ['🐳', 'whale docker 鲸鱼'],
      ['🐬', 'dolphin 海豚'],
      ['🐙', 'octopus github 章鱼'],
      ['🦀', 'crab rust 螃蟹'],
      ['🐍', 'snake python 蛇'],
      ['🐘', 'elephant php 大象'],
      ['🦄', 'unicorn 独角兽'],
      ['🐝', 'bee 蜜蜂'],
      ['🦋', 'butterfly 蝴蝶'],
      ['🐞', 'ladybug bug 瓢虫'],
      ['🐢', 'turtle slow 乌龟'],
      ['🦕', 'dinosaur 恐龙']
    ]
  },
  {
    group: 'food',
    emoji: [
      ['🍎', 'apple fruit 苹果'],
      ['🍊', 'orange 橙子'],
      ['🍋', 'lemon 柠檬'],
      ['🍉', 'watermelon 西瓜'],
      ['🍓', 'strawberry 草莓'],
      ['🥑', 'avocado 牛油果'],
      ['🥕', 'carrot 胡萝卜'],
      ['🌶️', 'pepper chili 辣椒'],
      ['🍞', 'bread 面包'],
      ['🍕', 'pizza 披萨'],
      ['🍔', 'burger 汉堡'],
      ['🍜', 'noodles ramen 面条'],
      ['🍣', 'sushi 寿司'],
      ['🍩', 'donut 甜甜圈'],
      ['🍪', 'cookie 饼干'],
      ['🎂', 'cake birthday 蛋糕'],
      ['☕', 'coffee 咖啡'],
      ['🍵', 'tea 茶'],
      ['🧋', 'bubble tea boba 奶茶'],
      ['🍺', 'beer 啤酒'],
      ['🍷', 'wine 红酒'],
      ['🧁', 'cupcake 纸杯蛋糕']
    ]
  },
  {
    group: 'fun',
    emoji: [
      ['🎨', 'art palette design 艺术 设计'],
      ['🖌️', 'paint brush 画笔'],
      ['🎬', 'film movie video 电影'],
      ['📷', 'camera photo 相机'],
      ['🎵', 'music note 音乐'],
      ['🎧', 'headphones audio 耳机'],
      ['🎸', 'guitar 吉他'],
      ['🎮', 'game controller 游戏'],
      ['🕹️', 'joystick arcade 摇杆'],
      ['🎲', 'dice game 骰子'],
      ['♟️', 'chess 国际象棋'],
      ['🎯', 'target goal 目标'],
      ['🏆', 'trophy win 奖杯'],
      ['🎁', 'gift present 礼物'],
      ['🎈', 'balloon party 气球'],
      ['🎉', 'party celebrate 庆祝'],
      ['⚽', 'soccer football 足球'],
      ['🏀', 'basketball 篮球'],
      ['🎾', 'tennis 网球'],
      ['🏃', 'run 跑步'],
      ['📸', 'camera flash 拍照'],
      ['🪁', 'kite 风筝']
    ]
  },
  {
    group: 'symbols',
    emoji: [
      ['✨', 'sparkles magic 闪光'],
      ['❤️', 'heart love red 爱心'],
      ['🧡', 'heart orange 爱心'],
      ['💛', 'heart yellow 爱心'],
      ['💚', 'heart green 爱心'],
      ['💙', 'heart blue 爱心'],
      ['💜', 'heart purple 爱心'],
      ['🖤', 'heart black 爱心'],
      ['✅', 'check done 完成'],
      ['❌', 'cross no 叉'],
      ['⚠️', 'warning 警告'],
      ['🚧', 'construction wip 施工中'],
      ['♻️', 'recycle 回收'],
      ['🔴', 'red circle 红色'],
      ['🟠', 'orange circle 橙色'],
      ['🟡', 'yellow circle 黄色'],
      ['🟢', 'green circle 绿色'],
      ['🔵', 'blue circle 蓝色'],
      ['🟣', 'purple circle 紫色'],
      ['⚫', 'black circle 黑色'],
      ['🔶', 'diamond orange 菱形'],
      ['🔷', 'diamond blue 菱形'],
      ['💎', 'gem diamond 宝石'],
      ['🧹', 'broom clean 扫帚']
    ]
  }
]
