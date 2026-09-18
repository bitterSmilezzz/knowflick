package com.knowflick.app.domain.search

import java.util.Collections
import java.util.LinkedHashMap

data class PhoneticPair(
    val full: String,
    val initials: String,
)

/**
 * 拼音与首字母转换中台：
 * 1. 运行时优先利用 Android 原生 ICU Transliterator (Han-Latin; Latin-Ascii; Lower())；
 * 2. 在 JVM 单元测试或无 ICU 环境下，平滑回退至内置拼音字典表与 GB2312 声母区间计算；
 * 3. 内置容量限制的 LRU 缓存，避免数百张卡片频繁重复转换开销。
 */
object PinyinHelper {

    private val icuTransliterator: Any? by lazy {
        runCatching {
            val clazz = Class.forName("android.icu.text.Transliterator")
            val getInstance = clazz.getMethod("getInstance", String::class.java)
            getInstance.invoke(null, "Han-Latin; Latin-Ascii; Lower()")
        }.getOrNull()
    }

    private val transliterateMethod by lazy {
        icuTransliterator?.let {
            runCatching { it.javaClass.getMethod("transliterate", String::class.java) }.getOrNull()
        }
    }

    private val gb2312Table = arrayOf(
        Triple(0xB0A1, 0xB0C4, 'a'),
        Triple(0xB0C5, 0xB2C0, 'b'),
        Triple(0xB2C1, 0xB4ED, 'c'),
        Triple(0xB4EE, 0xB6E9, 'd'),
        Triple(0xB6EA, 0xB7A1, 'e'),
        Triple(0xB7A2, 0xB8C0, 'f'),
        Triple(0xB8C1, 0xB9FD, 'g'),
        Triple(0xB9FE, 0xBBF6, 'h'),
        Triple(0xBBF7, 0xBFA5, 'j'),
        Triple(0xBFA6, 0xC0AB, 'k'),
        Triple(0xC0AC, 0xC2E7, 'l'),
        Triple(0xC2E8, 0xC4C2, 'm'),
        Triple(0xC4C3, 0xC5B5, 'n'),
        Triple(0xC5B6, 0xC5BD, 'o'),
        Triple(0xC5BE, 0xC6D9, 'p'),
        Triple(0xC6DA, 0xC8BA, 'q'),
        Triple(0xC8BB, 0xC8F5, 'r'),
        Triple(0xC8F6, 0xCBF9, 's'),
        Triple(0xCBFA, 0xCDD9, 't'),
        Triple(0xCDDA, 0xCEF3, 'w'),
        Triple(0xCEF4, 0xD1B8, 'x'),
        Triple(0xD1B9, 0xD4D0, 'y'),
        Triple(0xD4D1, 0xD7F9, 'z')
    )

    private val pinyinDict: Map<Char, String> by lazy {
        val map = HashMap<Char, String>(2500)
        val raw = "一:yi|丁:ding|七:qi|万:wan|三:san|上:shang|下:xia|不:bu|与:yu|专:zhuan|且:qie|世:shi|业:ye|丛:cong|东:dong|丝:si|丢:diu|两:liang|严:yan|丧:sang|个:ge|中:zhong|丰:feng|串:chuan|临:lin|丹:dan|为:wei|主:zhu|举:ju|久:jiu|么:me|义:yi|之:zhi|乌:wu|乎:hu|乐:le|乘:cheng|乙:yi|九:jiu|也:ye|习:xi|书:shu|买:mai|乱:luan|乳:ru|了:le|争:zheng|事:shi|二:er|于:yu|亏:kui|云:yun|互:hu|五:wu|亚:ya|些:xie|亡:wang|交:jiao|亦:yi|产:chan|亨:heng|享:xiang|京:jing|亮:liang|亲:qin|人:ren|亿:yi|什:shen|仁:ren|仅:jin|今:jin|介:jie|仍:reng|从:cong|仑:lun|仓:cang|他:ta|付:fu|仙:xian|代:dai|令:ling|以:yi|仪:yi|们:men|件:jian|价:jia|任:ren|份:fen|仿:fang|企:qi|伊:yi|伏:fu|休:xiu|众:zhong|优:you|伙:huo|会:hui|传:chuan|伤:shang|伦:lun|伪:wei|伯:bo|估:gu|伴:ban|伸:shen|似:si|伽:jia|但:dan|位:wei|低:di|住:zhu|佐:zuo|体:ti|何:he|余:yu|佛:fu|作:zuo|你:ni|佣:yong|佩:pei|佳:jia|使:shi|例:li|供:gong|依:yi|侧:ce|便:bian|促:cu|俄:e|俗:su|保:bao|信:xin|修:xiu|俯:fu|倍:bei|倒:dao|候:hou|借:jie|债:zhai|值:zhi|倾:qing|假:jia|偏:pian|偕:xie|做:zuo|停:ting|健:jian|偶:ou|偿:chang|储:chu|催:cui|像:xiang|儒:ru|儿:er|允:yun|元:yuan|充:chong|先:xian|光:guang|克:ke|免:mian|兑:dui|兜:dou|入:ru|全:quan|八:ba|公:gong|六:liu|兰:lan|共:gong|关:guan|兴:xing|兵:bing|其:qi|具:ju|典:dian|兹:zi|养:yang|兼:jian|兽:shou|内:nei|冈:gang|册:ce|再:zai|冒:mao|冗:rong|写:xie|军:jun|农:nong|冤:yuan|冬:dong|冰:bing|冲:chong|决:jue|况:kuang|冶:ye|冷:leng|冻:dong|净:jing|准:zhun|凉:liang|减:jian|凑:cou|凝:ning|几:ji|凭:ping|凸:tu|出:chu|击:ji|函:han|凿:zao|刀:dao|刃:ren|分:fen|切:qie|刊:kan|划:hua|列:lie|则:ze|刚:gang|创:chuang|初:chu|删:shan|判:pan|利:li|别:bie|刮:gua|到:dao|制:zhi|刷:shua|券:quan|刹:sha|刺:ci|刻:ke|剂:ji|削:xue|前:qian|剑:jian|剥:bo|剧:ju|剩:sheng|剪:jian|副:fu|割:ge|力:li|劝:quan|办:ban|功:gong|加:jia|务:wu|动:dong|助:zhu|努:nu|励:li|劳:lao|势:shi|勃:bo|勇:yong|勉:mian|勋:xun|勒:lei|勤:qin|勺:shao|勾:gou|勿:wu|匀:yun|包:bao|匍:pu|匐:fu|化:hua|北:bei|匙:shi|匠:jiang|匹:pi|区:qu|医:yi|匿:ni|十:shi|千:qian|升:sheng|午:wu|半:ban|华:hua|协:xie|卒:zu|单:dan|卖:mai|南:nan|博:bo|卟:bu|占:zhan|卡:ka|卫:wei|印:yin|危:wei|即:ji|却:que|卷:juan|厂:chang|厅:ting|历:li|压:ya|厌:yan|厘:li|厚:hou|原:yuan|厨:chu|去:qu|县:xian|参:can|又:you|叉:cha|及:ji|友:you|双:shuang|反:fan|发:fa|取:qu|受:shou|变:bian|叙:xu|叠:die|口:kou|古:gu|句:ju|另:ling|只:zhi|叫:jiao|召:zhao|可:ke|台:tai|史:shi|右:you|叶:ye|号:hao|司:si|叹:tan|吃:chi|各:ge|合:he|吉:ji|同:tong|名:ming|后:hou|吐:tu|向:xiang|吓:xia|吗:ma|吞:tun|否:fou|吨:dun|含:han|听:ting|启:qi|吸:xi|吹:chui|吻:wen|呈:cheng|告:gao|呐:na|员:yuan|周:zhou|味:wei|呼:hu|命:ming|和:he|咒:zhou|咖:ka|咬:yao|咸:xian|品:pin|哈:ha|响:xiang|哥:ge|哨:shao|哪:na|哲:zhe|售:shou|唯:wei|啃:ken|商:shang|啉:lin|啡:fei|喂:wei|善:shan|喊:han|喘:chuan|喜:xi|喝:he|喷:pen|喻:yu|嗜:shi|嘈:cao|器:qi|噩:e|噪:zao|囊:nang|四:si|回:hui|因:yin|团:tuan|园:yuan|困:kun|围:wei|固:gu|国:guo|图:tu|圈:quan|土:tu|圣:sheng|在:zai|圭:gui|地:de|场:chang|圾:ji|址:zhi|均:jun|坊:fang|坏:huai|坐:zuo|坑:keng|块:kuai|坚:jian|坡:po|坦:tan|垂:chui|垃:la|型:xing|垮:kua|埃:ai|埋:mai|城:cheng|域:yu|培:pei|基:ji|堂:tang|堆:dui|堪:kan|堵:du|塌:ta|塑:su|塔:ta|塞:sai|填:tian|境:jing|墓:mu|墙:qiang|增:zeng|墨:mo|壁:bi|士:shi|壮:zhuang|声:sheng|壳:ke|壶:hu|处:chu|备:bei|复:fu|夏:xia|外:wai|多:duo|夜:ye|够:gou|大:da|天:tian|太:tai|夫:fu|央:yang|失:shi|头:tou|夷:yi|夸:kua|夹:jia|奇:qi|奉:feng|奏:zou|奖:jiang|套:tao|奠:dian|奥:ao|女:nu|她:ta|好:hao|如:ru|妈:ma|妙:miao|姆:mu|始:shi|姿:zi|威:wei|娄:lou|娩:mian|婪:lan|媒:mei|媚:mei|嫁:jia|嫌:xian|子:zi|孕:yun|字:zi|存:cun|季:ji|孤:gu|学:xue|孩:hai|孰:shu|宁:ning|它:ta|宇:yu|守:shou|安:an|宋:song|完:wan|宏:hong|宕:dang|宗:zong|官:guan|宙:zhou|定:ding|宜:yi|宝:bao|实:shi|审:shen|客:ke|宣:xuan|室:shi|宫:gong|害:hai|宵:xiao|家:jia|容:rong|宽:kuan|宾:bin|宿:su|寂:ji|密:mi|富:fu|寞:mo|察:cha|寸:cun|对:dui|寻:xun|导:dao|寿:shou|封:feng|射:she|将:jiang|尊:zun|小:xiao|少:shao|尔:er|尖:jian|尘:chen|尚:shang|尝:chang|尤:you|就:jiu|尸:shi|尺:chi|尼:ni|尽:jin|尾:wei|局:ju|层:ceng|居:ju|屋:wu|屏:ping|屑:xie|展:zhan|属:shu|屡:lu|履:lu|山:shan|屿:yu|岁:sui|岗:gang|岛:dao|岩:yan|岭:ling|峭:qiao|峰:feng|崖:ya|崩:beng|嵌:qian|川:chuan|州:zhou|工:gong|左:zuo|巧:qiao|巨:ju|巩:gong|差:cha|己:ji|已:yi|巴:ba|币:bi|市:shi|布:bu|师:shi|希:xi|帕:pa|帝:di|带:dai|帧:zhen|帮:bang|常:chang|幂:mi|幅:fu|幔:man|干:gan|平:ping|年:nian|并:bing|幸:xing|幻:huan|幼:you|幽:you|广:guang|床:chuang|序:xu|库:ku|应:ying|底:di|店:dian|府:fu|庞:pang|废:fei|度:du|座:zuo|庭:ting|康:kang|庸:yong|廉:lian|廊:lang|延:yan|廷:ting|建:jian|开:kai|异:yi|弃:qi|弄:nong|式:shi|引:yin|弗:fu|弛:chi|张:zhang|弥:mi|弦:xian|弯:wan|弱:ruo|弹:dan|强:qiang|归:gui|当:dang|录:lu|彗:hui|形:xing|彤:tong|彩:cai|彰:zhang|影:ying|彻:che|彼:bi|往:wang|征:zheng|径:jing|待:dai|很:hen|律:lu|徒:tu|得:de|御:yu|循:xun|微:wei|德:de|心:xin|必:bi|忆:yi|忍:ren|志:zhi|忘:wang|快:kuai|念:nian|忽:hu|怀:huai|态:tai|怎:zen|怕:pa|思:si|急:ji|性:xing|怪:guai|总:zong|恐:kong|恒:heng|恢:hui|息:xi|恰:qia|恶:e|悄:qiao|悉:xi|悖:bei|患:huan|悬:xuan|情:qing|惊:jing|惜:xi|惦:dian|惧:ju|惩:cheng|惯:guan|想:xiang|愈:yu|意:yi|愚:yu|感:gan|愿:yuan|慌:huang|慎:shen|慢:man|慧:hui|慰:wei|懂:dong|戈:ge|戏:xi|成:cheng|我:wo|戒:jie|或:huo|战:zhan|截:jie|戳:chuo|戴:dai|户:hu|房:fang|所:suo|扇:shan|手:shou|才:cai|扑:pu|打:da|托:tuo|扛:kang|扣:kou|执:zhi|扩:kuo|扫:sao|扬:yang|扭:niu|扯:che|扰:rao|批:pi|找:zhao|承:cheng|技:ji|抄:chao|把:ba|抑:yi|抓:zhua|投:tou|抖:dou|抗:kang|折:zhe|抛:pao|抢:qiang|护:hu|报:bao|披:pi|抱:bao|抵:di|抹:mo|押:ya|抽:chou|担:dan|拆:chai|拉:la|拍:pai|拒:ju|拓:ta|拔:ba|拖:tuo|招:zhao|拜:bai|拟:ni|拥:yong|拦:lan|拧:ning|择:ze|括:kuo|拷:kao|拼:pin|拽:zhuai|拿:na|持:chi|挂:gua|指:zhi|按:an|挑:tiao|挖:wa|挡:dang|挣:zheng|挤:ji|挥:hui|挪:nuo|挫:cuo|振:zhen|捉:zhuo|捕:bu|损:sun|换:huan|捣:dao|据:ju|捶:chui|掀:xian|授:shou|掉:diao|掌:zhang|排:pai|探:tan|接:jie|控:kong|推:tui|掩:yan|掷:zhi|描:miao|提:ti|插:cha|握:wo|揭:jie|搏:bo|搜:sou|搞:gao|搬:ban|搭:da|携:xie|摄:she|摆:bai|摊:tan|摘:zhai|摧:cui|摩:mo|摸:mo|撑:cheng|撒:sa|撕:si|撞:zhuang|撤:che|播:bo|撰:zhuan|撼:han|擅:shan|操:cao|擎:qing|擦:ca|攥:zuan|支:zhi|收:shou|改:gai|攻:gong|放:fang|政:zheng|故:gu|效:xiao|敌:di|敏:min|教:jiao|敛:lian|敞:chang|敢:gan|散:san|敦:dun|数:shu|敲:qiao|整:zheng|敷:fu|文:wen|斑:ban|斗:dou|料:liao|斜:xie|斤:jin|斥:chi|斩:zhan|断:duan|斯:si|新:xin|方:fang|施:shi|旁:pang|旅:lu|旋:xuan|族:zu|旗:qi|无:wu|既:ji|日:ri|旦:dan|旧:jiu|早:zao|旱:han|时:shi|昂:ang|明:ming|昏:hun|易:yi|星:xing|映:ying|是:shi|昼:zhou|显:xian|晃:huang|晋:jin|晓:xiao|晕:yun|晚:wan|普:pu|景:jing|晰:xi|晴:qing|晶:jing|智:zhi|暂:zan|暖:nuan|暗:an|暴:bao|曲:qu|更:geng|書:shu|曼:man|曾:ceng|替:ti|最:zui|月:yue|有:you|朋:peng|服:fu|朗:lang|望:wang|朝:chao|期:qi|木:mu|未:wei|末:mo|本:ben|术:shu|朱:zhu|朴:pu|朵:duo|机:ji|朽:xiu|杀:sha|杂:za|权:quan|杆:gan|李:li|杏:xing|材:cai|杜:du|束:shu|杠:gang|条:tiao|来:lai|杯:bei|杰:jie|松:song|板:ban|极:ji|构:gou|析:xi|林:lin|枚:mei|果:guo|枝:zhi|枢:shu|枯:ku|架:jia|柏:bai|某:mou|染:ran|柔:rou|查:cha|柱:zhu|柴:chai|柿:shi|标:biao|栈:zhan|栏:lan|树:shu|栖:qi|校:xiao|样:yang|核:he|根:gen|格:ge|栽:zai|桃:tao|框:kuang|案:an|桌:zhuo|档:dang|桥:qiao|桩:zhuang|桶:tong|梅:mei|梗:geng|梦:meng|梯:ti|械:xie|检:jian|棉:mian|棒:bang|森:sen|棵:ke|植:zhi|椎:zhui|椒:jiao|楔:xie|楚:chu|楼:lou|概:gai|榜:bang|槛:kan|槽:cao|模:mo|横:heng|樱:ying|橙:cheng|欠:qian|次:ci|欢:huan|欣:xin|欧:ou|欺:qi|款:kuan|歇:xie|歌:ge|止:zhi|正:zheng|此:ci|步:bu|歪:wai|死:si|殊:shu|残:can|殖:zhi|段:duan|毁:hui|母:mu|每:mei|毒:du|比:bi|毛:mao|毫:hao|氏:shi|民:min|气:qi|氢:qing|氦:hai|氧:yang|氮:dan|氯:lu|水:shui|永:yong|汁:zhi|求:qiu|汇:hui|汉:han|汐:xi|汗:han|池:chi|污:wu|汤:tang|汽:qi|沃:wo|沉:chen|沙:sha|沛:pei|沟:gou|没:mei|沪:hu|河:he|油:you|治:zhi|沼:zhao|沿:yan|泄:xie|泉:quan|泊:po|泌:mi|法:fa|泛:fan|泡:pao|波:bo|泥:ni|注:zhu|泰:tai|泳:yong|泵:beng|泼:po|泽:ze|洁:jie|洋:yang|洗:xi|洛:luo|洞:dong|津:jin|洪:hong|洲:zhou|活:huo|派:pai|流:liu|浅:qian|浆:jiang|浊:zhuo|测:ce|济:ji|浓:nong|浩:hao|浪:lang|浮:fu|浴:yu|海:hai|涂:tu|涅:nie|消:xiao|涉:she|涌:yong|涟:lian|涡:wo|润:run|涨:zhang|液:ye|涸:he|淀:dian|淆:xiao|淋:lin|淌:tang|淡:dan|深:shen|混:hun|淹:yan|添:tian|清:qing|渊:yuan|渐:jian|渔:yu|渗:shen|温:wen|港:gang|渲:xuan|游:you|湖:hu|湾:wan|湿:shi|溃:kui|溉:gai|源:yuan|溢:yi|溯:su|溴:xiu|溶:rong|滑:hua|滚:gun|滞:zhi|满:man|滤:lu|滥:lan|滩:tan|漂:piao|漏:lou|演:yan|漠:mo|漢:han|漪:yi|漫:man|潜:qian|潮:chao|澄:cheng|澳:ao|激:ji|灌:guan|火:huo|灭:mie|灯:deng|灰:hui|灵:ling|灼:zhuo|灾:zai|炉:lu|炎:yan|炫:xuan|炮:pao|炸:zha|点:dian|炼:lian|烂:lan|烈:lie|烟:yan|烦:fan|烧:shao|热:re|烯:xi|焦:jiao|然:ran|照:zhao|熊:xiong|熔:rong|熟:shu|熬:ao|熵:shang|燃:ran|燥:zao|爆:bao|爬:pa|爱:ai|爽:shuang|片:pian|版:ban|牌:pai|牙:ya|牛:niu|牢:lao|牧:mu|物:wu|牲:sheng|牵:qian|特:te|牺:xi|犯:fan|状:zhuang|犸:ma|狗:gou|狩:shou|独:du|狭:xia|狱:yu|狼:lang|猎:lie|猕:mi|猛:meng|猜:cai|猩:xing|猫:mao|献:xian|猴:hou|玄:xuan|率:lu|玉:yu|王:wang|玛:ma|玩:wan|环:huan|现:xian|玻:bo|珀:po|珠:zhu|班:ban|球:qiu|理:li|琥:hu|琴:qin|瑞:rui|璃:li|瓜:gua|瓦:wa|瓶:ping|甚:shen|甜:tian|生:sheng|用:yong|田:tian|由:you|甲:jia|申:shen|电:dian|男:nan|画:hua|畅:chang|界:jie|留:liu|略:lue|番:fan|疆:jiang|疏:shu|疑:yi|疗:liao|疫:yi|疹:zhen|疼:teng|疾:ji|病:bing|症:zheng|痒:yang|痕:hen|痛:tong|痪:huan|痫:xian|瘟:wen|瘦:shou|瘫:tan|癌:ai|癖:pi|癫:dian|登:deng|白:bai|百:bai|皂:zao|的:de|皇:huang|皮:pi|盈:ying|益:yi|盏:zhan|盐:yan|监:jian|盒:he|盖:gai|盘:pan|盛:sheng|盟:meng|目:mu|盯:ding|盲:mang|直:zhi|相:xiang|盾:dun|省:sheng|看:kan|真:zhen|眠:mian|眼:yan|着:zhe|睛:jing|睡:shui|督:du|瞎:xia|瞬:shun|瞻:zhan|矛:mao|知:zhi|矩:ju|短:duan|矮:ai|石:shi|矿:kuang|码:ma|研:yan|破:po|砷:shen|砸:za|础:chu|硫:liu|硬:ying|确:que|碍:ai|碎:sui|碗:wan|碘:dian|碟:die|碰:peng|碱:jian|碳:tan|碾:nian|磁:ci|磕:ke|磨:mo|磷:lin|示:shi|礼:li|社:she|祀:si|祝:zhu|神:shen|票:piao|祭:ji|祸:huo|禁:jin|福:fu|禧:xi|离:li|秀:xiu|私:si|种:zhong|科:ke|秒:miao|秘:mi|租:zu|积:ji|称:cheng|移:yi|稀:xi|程:cheng|稍:shao|税:shui|稳:wen|稽:ji|稿:gao|穆:mu|究:jiu|穷:qiong|空:kong|穿:chuan|突:tu|窗:chuang|立:li|竖:shu|站:zhan|竞:jing|竟:jing|章:zhang|童:tong|竭:jie|端:duan|笑:xiao|笔:bi|符:fu|第:di|笼:long|等:deng|筑:zhu|答:da|策:ce|筛:shai|筷:kuai|筹:chou|签:qian|简:jian|算:suan|管:guan|箱:xiang|篇:pian|篡:cuan|篮:lan|簿:bu|米:mi|类:lei|粉:fen|粒:li|粗:cu|粘:zhan|粤:yue|粥:zhou|粮:liang|粹:cui|精:jing|糊:hu|糖:tang|糟:zao|系:xi|素:su|索:suo|紧:jin|紫:zi|累:lei|繁:fan|纠:jiu|红:hong|纤:xian|约:yue|级:ji|纪:ji|纯:chun|纲:gang|纳:na|纵:zong|纸:zhi|纹:wen|纽:niu|线:xian|练:lian|组:zu|细:xi|织:zhi|终:zhong|绊:ban|绎:yi|经:jing|绑:bang|结:jie|绕:rao|绘:hui|给:gei|络:luo|绝:jue|统:tong|继:ji|绩:ji|绪:xu|续:xu|绰:chuo|维:wei|绵:mian|综:zong|绿:lu|缀:zhui|缆:lan|缓:huan|编:bian|缠:chan|缩:suo|缴:jiao|缸:gang|缺:que|罐:guan|网:wang|罕:han|罗:luo|罚:fa|置:zhi|署:shu|羊:yang|美:mei|群:qun|翅:chi|翰:han|翻:fan|翼:yi|老:lao|考:kao|者:zhe|而:er|耐:nai|耗:hao|耦:ou|耳:er|聊:liao|职:zhi|联:lian|聚:ju|聪:cong|肃:su|肉:rou|肋:lei|肌:ji|肝:gan|肠:chang|股:gu|肤:fu|肥:fei|肩:jian|肪:fang|肯:ken|育:yu|肽:tai|胀:zhang|胁:xie|胃:wei|胆:dan|背:bei|胎:tai|胜:sheng|胞:bao|胡:hu|胸:xiong|胺:an|能:neng|脂:zhi|脆:cui|脉:mai|脊:ji|脏:zang|脑:nao|脚:jiao|脱:tuo|脸:lian|脾:pi|腊:la|腐:fu|腔:qiang|腕:wan|腰:yao|腹:fu|腺:xian|膀:bang|膜:mo|膨:peng|臂:bi|自:zi|臬:nie|至:zhi|致:zhi|舌:she|舍:she|舒:shu|航:hang|般:ban|舰:jian|舱:cang|船:chuan|良:liang|艰:jian|色:se|艳:yan|艺:yi|艾:ai|节:jie|芦:lu|芬:fen|芯:xin|花:hua|苏:su|苗:miao|苜:mu|若:ruo|苦:ku|英:ying|苷:gan|苹:ping|范:fan|茄:jia|茨:ci|茬:cha|茶:cha|草:cao|荐:jian|荡:dang|荣:rong|荧:ying|荫:yin|药:yao|荷:he|莓:mei|莫:mo|莱:lai|获:huo|菌:jun|菜:cai|菠:bo|菲:fei|萄:tao|萎:wei|萝:luo|营:ying|萨:sa|落:luo|著:zhu|葡:pu|董:dong|葫:hu|葬:zang|蒂:di|蒙:meng|蒸:zheng|蓄:xu|蓝:lan|蓬:peng|蓿:xu|蔓:man|蔡:cai|蔬:shu|蔽:bi|蕉:jiao|蕾:lei|薄:bao|薪:xin|藏:cang|藻:zao|虎:hu|虑:lu|虚:xu|虫:chong|虽:sui|虾:xia|蚀:shi|蛋:dan|蛰:zhe|蛾:e|蜂:feng|蜜:mi|蝉:chan|螅:xi|融:rong|螺:luo|蠢:chun|血:xue|行:xing|衍:yan|衔:xian|衡:heng|补:bu|表:biao|衬:chen|衰:shuai|衷:zhong|袋:dai|被:bei|袱:fu|裁:cai|裂:lie|装:zhuang|裹:guo|褐:he|褪:tui|西:xi|要:yao|覆:fu|见:jian|观:guan|规:gui|视:shi|览:lan|觉:jue|角:jiao|解:jie|触:chu|言:yan|詹:zhan|誓:shi|警:jing|计:ji|订:ding|认:ren|讨:tao|让:rang|训:xun|议:yi|记:ji|讲:jiang|讶:ya|许:xu|讹:e|论:lun|讽:feng|设:she|访:fang|诀:jue|证:zheng|评:ping|识:shi|诈:zha|诉:su|诊:zhen|词:ci|译:yi|试:shi|诚:cheng|话:hua|诞:dan|询:xun|该:gai|语:yu|误:wu|诱:you|说:shuo|请:qing|诺:nuo|读:du|课:ke|谁:shei|调:diao|谄:chan|谈:tan|谐:xie|谓:wei|谙:an|谚:yan|谜:mi|谢:xie|谣:yao|谨:jin|谭:tan|谱:pu|谷:gu|豁:huo|象:xiang|貌:mao|贝:bei|负:fu|贡:gong|财:cai|责:ze|败:bai|账:zhang|货:huo|质:zhi|贪:tan|贬:bian|购:gou|贯:guan|贱:jian|贴:tie|贵:gui|贷:dai|贸:mao|费:fei|贾:jia|赁:lin|资:zi|赊:she|赋:fu|赌:du|赎:shu|赏:shang|赐:ci|赔:pei|赖:lai|赚:zhuan|赛:sai|赞:zan|赢:ying|赫:he|走:zou|赶:gan|起:qi|超:chao|越:yue|趋:qu|趣:qu|足:zu|趴:pa|跃:yue|跌:die|跑:pao|距:ju|跟:gen|跨:kua|路:lu|跳:tiao|践:jian|跺:duo|踪:zong|身:shen|躺:tang|车:che|轨:gui|轩:xuan|转:zhuan|轮:lun|软:ruan|轴:zhou|轻:qing|载:zai|较:jiao|辄:zhe|辅:fu|辈:bei|辐:fu|辑:ji|输:shu|辟:pi|辣:la|辨:bian|边:bian|达:da|迁:qian|迅:xun|过:guo|迎:ying|运:yun|近:jin|返:fan|还:hai|这:zhe|进:jin|远:yuan|违:wei|连:lian|迟:chi|迦:jia|迪:di|迫:po|迭:die|述:shu|迷:mi|迹:ji|追:zhui|退:tui|送:song|适:shi|逃:tao|逆:ni|选:xuan|透:tou|逐:zhu|递:di|途:tu|通:tong|逝:shi|速:su|造:zao|逢:feng|逸:yi|逻:luo|逼:bi|逾:yu|遇:yu|遍:bian|道:dao|遗:yi|遥:yao|遵:zun|避:bi|邓:deng|那:na|邦:bang|邮:you|邻:lin|郡:jun|部:bu|都:dou|配:pei|酒:jiu|酪:lao|酬:chou|酱:jiang|酵:jiao|酶:mei|酷:ku|酸:suan|酿:niang|醉:zui|醒:xing|醚:mi|采:cai|释:shi|里:li|重:zhong|量:liang|金:jin|鉴:jian|针:zhen|钉:ding|钞:chao|钟:zhong|钠:na|钢:gang|钥:yao|钱:qian|钻:zuan|钾:jia|铁:tie|铅:qian|铜:tong|铝:lu|铠:kai|铯:se|银:yin|铺:pu|链:lian|销:xiao|锁:suo|锅:guo|锋:feng|锏:jian|锐:rui|错:cuo|锚:mao|锟:kun|锡:xi|锦:jin|锭:ding|键:jian|锻:duan|镁:mei|镇:zhen|镓:jia|镜:jing|长:zhang|门:men|闭:bi|问:wen|闲:xian|间:jian|闸:zha|闽:min|阅:yue|阈:yu|队:dui|阱:jing|防:fang|阳:yang|阴:yin|阵:zhen|阶:jie|阻:zu|阿:a|陀:tuo|附:fu|际:ji|陆:lu|陈:chen|陋:lou|陌:mo|降:jiang|限:xian|陡:dou|院:yuan|除:chu|险:xian|陪:pei|陵:ling|陶:tao|陷:xian|隆:long|随:sui|隐:yin|隔:ge|隙:xi|障:zhang|隧:sui|难:nan|雅:ya|集:ji|雏:chu|雨:yu|雪:xue|零:ling|雷:lei|雾:wu|需:xu|震:zhen|霍:huo|霜:shuang|露:lu|霸:ba|青:qing|静:jing|非:fei|靠:kao|面:mian|革:ge|韩:han|音:yin|页:ye|顶:ding|项:xiang|顺:shun|须:xu|顿:dun|颁:ban|预:yu|颅:lu|领:ling|颈:jing|频:pin|颗:ke|题:ti|颜:yan|额:e|颞:nie|颠:dian|风:feng|飓:ju|飘:piao|飙:biao|飞:fei|食:shi|餐:can|饥:ji|饭:fan|饮:yin|饰:shi|饲:si|饿:e|馅:xian|馆:guan|馈:kui|馏:liu|首:shou|香:xiang|马:ma|驱:qu|驶:shi|驻:zhu|驾:jia|骂:ma|验:yan|骑:qi|骗:pian|骤:zhou|骨:gu|髓:sui|高:gao|魅:mei|魔:mo|鱼:yu|鲁:lu|鲜:xian|鲨:sha|鳃:sai|鳍:qi|鳔:biao|鸟:niao|鸡:ji|鹿:lu|麦:mai|麻:ma|黄:huang|黎:li|黑:hei|默:mo|鼎:ding|鼠:shu|鼻:bi|齐:qi|龄:ling|龙:long"
        val tokens = raw.split('|')
        for (token in tokens) {
            val sep = token.indexOf(':')
            if (sep > 0) {
                val ch = token[0]
                val py = token.substring(sep + 1)
                map[ch] = py
            }
        }
        map
    }

    private const val CACHE_CAPACITY = 1024

    private val cache: MutableMap<String, PhoneticPair> = Collections.synchronizedMap(
        object : LinkedHashMap<String, PhoneticPair>(CACHE_CAPACITY, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, PhoneticPair>?): Boolean {
                return size > CACHE_CAPACITY
            }
        }
    )

    fun phonetics(text: String): PhoneticPair {
        if (text.isEmpty()) return PhoneticPair("", "")
        cache[text]?.let { return it }

        // 1. 尝试原生 ICU Transliterator
        val icuResult = runCatching {
            val method = transliterateMethod ?: return@runCatching null
            val obj = icuTransliterator ?: return@runCatching null
            val transliterated = method.invoke(obj, text) as? String ?: return@runCatching null

            val clean = transliterated.lowercase().trim()
            val fullBuilder = StringBuilder(clean.length)
            val initBuilder = StringBuilder(text.length)
            var prevIsWhitespace = true

            for (ch in clean) {
                if (ch in 'a'..'z' || ch in '0'..'9') {
                    fullBuilder.append(ch)
                    if (prevIsWhitespace) {
                        initBuilder.append(ch)
                        prevIsWhitespace = false
                    }
                } else if (ch.isWhitespace() || ch == '\'') {
                    prevIsWhitespace = true
                }
            }
            PhoneticPair(fullBuilder.toString(), initBuilder.toString())
        }.getOrNull()

        val pair = if (icuResult != null && (icuResult.full.isNotEmpty() || icuResult.initials.isNotEmpty())) {
            icuResult
        } else {
            fallbackPhonetics(text)
        }

        cache[text] = pair
        return pair
    }

    fun pinyin(text: String): String = phonetics(text).full

    fun initials(text: String): String = phonetics(text).initials

    private fun fallbackPhonetics(text: String): PhoneticPair {
        val full = StringBuilder()
        val inits = StringBuilder()

        for (ch in text) {
            if (ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9') {
                val lower = ch.lowercaseChar()
                full.append(lower)
                inits.append(lower)
            } else if (ch in '\u4e00'..'\u9fff') {
                val py = pinyinDict[ch]
                if (py != null) {
                    full.append(py)
                    inits.append(py[0])
                } else {
                    val init = getGb2312Initial(ch)
                    if (init != null) {
                        full.append(init)
                        inits.append(init)
                    }
                }
            }
        }
        return PhoneticPair(full.toString(), inits.toString())
    }

    private fun getGb2312Initial(ch: Char): Char? {
        return try {
            val bytes = ch.toString().toByteArray(charset("GB2312"))
            if (bytes.size == 2) {
                val b0 = bytes[0].toInt() and 0xFF
                val b1 = bytes[1].toInt() and 0xFF
                val code = (b0 shl 8) or b1
                for (triple in gb2312Table) {
                    if (code in triple.first..triple.second) {
                        return triple.third
                    }
                }
            }
            null
        } catch (_: Throwable) {
            null
        }
    }
}
