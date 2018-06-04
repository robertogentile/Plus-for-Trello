/// <reference path="intellisense.js" />

var g_valDayExtra = null;
var g_bNoAnimationDelay = false; //to optimize animation when pressing back button
var SEKEYWORD_LEGACY = "plus s/e";
var g_fnCancelSEBar = null;
var g_cardsById = {}; //has name, nameBoard, nameList, shortLink. used for navigation as jqm cant yet store well params in url
var g_delayKB = 350; //keyboard animation delay (aprox based on android)

function getAllKeywords(bExcludeLegacyLast) {
    var strKeywords = localStorage[PROP_PLUSKEYWORDS] || "";
    var rgKeywords = [];
    strKeywords.split(",").forEach(function (k) {
        rgKeywords.push(k.toLowerCase().trim());
    });
    if (bExcludeLegacyLast && rgKeywords.length > 0 && rgKeywords[rgKeywords.length - 1] == SEKEYWORD_LEGACY)
        rgKeywords.pop();
    return rgKeywords;
}

//recent s/e rows entered from the app. when a card s/e is read, its rows are removed from here.
//purpose is to easily patch the offline s/e cache
var g_recentRows = {
    PROP: "recentRows",
    MAXIMUM: 200,
    pushRow: function (idCard, msDate, user, keyword, s, e, bENew) {
        assert(this.bInited);
        var rows = this.rows;
        rows.push({ idCard: idCard, msDate: msDate, user: user, keyword: keyword, s: s, e: e, bENew: bENew });
        while (rows.length > this.MAXIMUM)
            rows.shift();
        this.saveProp();
    },
    get: function (idCard) {
        assert(this.bInited);
        var rows = this.rows;
        var rg=[];
        var row;
        for (var i = 0; i < rows.length; i++) {
            row = rows[i];
            if (row.idCard == idCard)
                rg.push(row);
        }
        return rg;
    },
    remove: function (idCard) {
        assert(this.bInited);
        var rows = this.rows;
        var rg = [];
        var row;
        var bUpdate = false;
        for (var i = 0; i < rows.length; i++) {
            row = rows[i];
            if (row.idCard != idCard)
                rg.push(row);
            else
                bUpdate = true;
        }
        if (bUpdate) {
            this.rows = rg;
            this.saveProp();
        }
    },
    saveProp: function () {
        assert(this.bInited);
        localStorage[this.PROP] = JSON.stringify(this.rows);
    },
    init: function () {
        if (this.bInited)
            return;
        this.bInited = true;
        var store = localStorage[this.PROP];
        if (store)
            this.rows = JSON.parse(store);
    },
    reset: function () {
        assert(this.bInited);
        delete localStorage[this.PROP];
        this.rows = [];
    },
    rows: [],
    bInited: false
};

//information about s/e for the current card, per user
var g_seCard = {
    clear: function() {
        this.m_mapUsers = {};
        this.m_bRecurring = false;
        this.m_bVersion1 = false;
        this.m_bFresh = false;
        this.m_iOrderNext = 0;
    },
    setNull: function () {
        this.clear();
        this.m_mapUsers = null;
    },
    isNull : function () {
        return (this.m_mapUsers === null);
    },
    setRecurring: function (bRecurring) {
        assert(this.m_mapUsers);
        this.m_bRecurring = bRecurring;
    },
    isRecurring: function () {
        assert(this.m_mapUsers);
        return (this.m_bRecurring);
    },
    //data comes from Trello, not the offline cache
    setFresh: function (bFresh) {
        assert(this.m_mapUsers);
        this.m_bFresh = bFresh;
    },
    isFresh: function () {
        return (this.m_bFresh);
    },
    isUserMapped(user) {
        assert(this.m_mapUsers);
        return !(!this.m_mapUsers[user]);
    },
    setEFirstForUser: function (user, eFirst) {
        assert(user);
        assert(this.m_mapUsers);
        var mapCur = this.m_mapUsers[user];
        assert(mapCur);
        mapCur.eFirst = (mapCur.eFirst || 0)+eFirst;
    },
    setSeCurForUser: function (user, s, e, keyword) {
        //see extension fillCardSEStats
        assert(user);
        assert(this.m_mapUsers);
        var mapCur = this.m_mapUsers[user];
        if (!mapCur) {
            mapCur = {
                s: s,
                e: e,
                kw: {}
            };
            this.m_mapUsers[user] = mapCur;
        } else {
            mapCur.s = mapCur.s + s;
            mapCur.e = mapCur.e + e;
        }
        mapCur.iOrder = this.m_iOrderNext;
        this.m_iOrderNext++;
        if (keyword) {
            assert(mapCur.kw);
            var mapKW = mapCur.kw[keyword];
            if (!mapKW) {
                mapKW = {
                    s: s,
                    e: e
                };
                mapCur.kw[keyword] = mapKW;
            } else {
                mapKW.s = mapKW.s + s;
                mapKW.e = mapKW.e + e;
            }
        } else {
            this.m_bVersion1 = true; //happens if the user had version1 data serialized in localStorage. once online, this gets overwritten by new format
        }
    },
    forEachUser: function (callback) { //callback(user,map)
        assert(this.m_mapUsers);
        var rgRet=[];
        for (var userMapped in this.m_mapUsers)
            rgRet.push({ map: this.m_mapUsers[userMapped], user:userMapped });
        rgRet.sort(function (a, b) {
            return (a.map.iOrder - b.map.iOrder);
        });
        for (var i in rgRet) {
            callback(rgRet[i].user, rgRet[i].map);
        }
    },
    isVersion1: function (user) { //old version1 didnt save s/e per kw. used by E autocomplete when adding new S/E
        assert(!this.isNull());
        return this.m_bVersion1;
    },
    getSeCurForUser: function (user, keyword) {
        assert(this.m_mapUsers);
        var map = this.m_mapUsers[user] || { s: 0, e: 0, kw: {} };
        var mapRet = map;

        if (keyword) {
            assert(mapRet.kw);
            mapRet = mapRet.kw[keyword];
            if (!mapRet) {
                if (this.m_bVersion1) {
                    //warning: this happens when the user has old version1 data and offline. pretend the old total card s/e was for that keyword,
                    //for autocomplete scenarios. later before commit we verify that the data was upgraded and recalculated, otherwise it wont let commit
                    //as the autocomplete could be incorrect on multiple-keyword scenarios
                    mapRet = map;
                }
                else
                    mapRet = { s: 0, e: 0 };
            }
        }
        return mapRet;
    },

    //private:
    m_mapUsers: null,
    m_bRecurring: false,
    m_bVersion1: false,
    m_bFresh: false
};

function splitUnitParts(str) {
    var parts = ("" + (str || "")).split(":");
    while (parts.length < 2)
        parts.push("");
    assert(parts.length == 2);
    return parts;
}

function updateEOnSChange(page) {
    var idCardCur = g_stateContext.idCard;

    function finish() {
        updateNoteR(page);
    }

    setTimeout(function () {
        doUpdate(0);
        function doUpdate(cRetry) {
            var bHiliteEMain = false;
            var bHiliteESub = false;
            cRetry = cRetry || 0;
            if (g_stateContext.idPage != "pageCardDetail" || idCardCur != g_stateContext.idCard)
                return;

            if (g_seCard.isNull()) {
                if (cRetry < 3) {
                    setTimeout(function () {
                        if (page.find("#plusCardCommentSpent").is(":focus") || page.find("#plusCardCommentSpent2").is(":focus"))
                            doUpdate(cRetry + 1);
                    }, 200);
                }
                return;
            }
            if (!updateCurrentSEData(page, true, false, true)) {
                finish();
                return;
            }

            var sParsed = parseFixedFloat(g_currentCardSEData.s);
            var eParsed = parseFixedFloat(g_currentCardSEData.e);
            var partsEOrig = splitUnitParts(g_currentCardSEData.e || "");
            var parts = null;
            if (g_seCard.isRecurring()) {
                if (g_bDisplayPointUnits) {
                    page.find("#plusCardCommentSpent").val(sParsed);
                    if (sParsed != eParsed)
                        bHiliteEMain = true;
                }
                else {
                    parts = splitUnitParts(g_currentCardSEData.s);
                    page.find("#plusCardCommentEst").val(parts[0]);
                    page.find("#plusCardCommentEst2").val(parts[1]);
                    if (partsEOrig[0] != parts[0])
                        bHiliteEMain = true;
                    if (partsEOrig[1] != parts[1])
                        bHiliteESub = true;
                }
            } else if (!g_bAllowNegativeRemaining) {
                var mapSeCur = g_seCard.getSeCurForUser(g_currentCardSEData.user, g_currentCardSEData.keyword);
                if (!mapSeCur)
                    return; //should not happen
                var sNew = mapSeCur.s + sParsed;
                var floatDiff = sNew - mapSeCur.e; //compare with original e
                if (floatDiff <= 0)
                    floatDiff = 0;
                var diff = parseFixedFloat(floatDiff);
                if (diff <= 0) {
                    diff = "";
                    floatDiff = 0;
                }

                if (eParsed != floatDiff) {
                    if (g_bDisplayPointUnits) {
                        page.find("#plusCardCommentEst").val(diff);
                        if (floatDiff != eParsed)
                            bHiliteEMain = true;
                    }
                    else {
                        if (g_currentCardSEData.s.indexOf(":") >= 0)
                            diff = UNITS.FormatWithColon(floatDiff);

                        parts = splitUnitParts("" + diff);
                        page.find("#plusCardCommentEst").val(parts[0]);
                        page.find("#plusCardCommentEst2").val(parts[1]);
                        if (partsEOrig[0] != parts[0])
                            bHiliteEMain = true;
                        if (partsEOrig[1] != parts[1])
                            bHiliteESub = true;
                    }
                }
            }

            if (bHiliteEMain)
                hiliteOnce(page.find("#plusCardCommentEst"), 500);
            if (bHiliteESub)
                hiliteOnce(page.find("#plusCardCommentEst2"), 500);

            finish();
        }
    }, 1); //breathe
}

function updateNoteR(page, bDontSaveToStorage) {
    var elem = page.find("#plusCardEditMessage");
    //get data now, but dont save to storage yet
    if (!updateCurrentSEData(page, true, false, true)) {
        elem.text("Format error.");
        return;
    }
    if (!bDontSaveToStorage) {
        //save to storage async
        updateCurrentSEData(page);
    }
    var sParsed = parseFixedFloat(g_currentCardSEData.s);
    var eParsed = parseFixedFloat(g_currentCardSEData.e);
    var mapSe = g_seCard.getSeCurForUser(g_currentCardSEData.user, g_currentCardSEData.keyword);
    if (sParsed == 0 && eParsed == 0) {
        elem.html("&nbsp;");
        return;
    }
    var sumS = sParsed + mapSe.s;
    var sumE = eParsed + mapSe.e;
    var rDiff = parseFixedFloat(sumE - sumS);
    var rDiffFormatted = rDiff;
    if (!g_bDisplayPointUnits && g_currentCardSEData.s.indexOf(".") < 0 && g_currentCardSEData.e.indexOf(".") < 0)
        rDiffFormatted = UNITS.FormatWithColon(rDiff, true);
    var noteFinal = " R will be " + rDiffFormatted + (g_bAllowNegativeRemaining ||  rDiff != 0 ? "" : ". Increase E if not done");
    elem.text(noteFinal);
}

function getSEStringsFromEdits(page, bSilent) {
    var objRet = { status: "error" };
    var panelAddSE = page.find($("#panelAddSE"));
    if (panelAddSE.length == 0)
        return objRet;

    function errorRet(elem) {
        if (!bSilent) {
            alertMobile("Format error");
            hiliteOnce(elem); //dont set focus as keyboard can hide alert
        }
        return objRet;
    }

    var elemSpentMain = panelAddSE.find("#plusCardCommentSpent");
    var elemSpentSub = panelAddSE.find("#plusCardCommentSpent2");
    var elemEstMain = panelAddSE.find("#plusCardCommentEst");
    var elemEstSub = panelAddSE.find("#plusCardCommentEst2");

    var sMain = elemSpentMain.val().trim();
    var sSub = g_bDisplayPointUnits? "" : elemSpentSub.val().trim();
    var eMain = elemEstMain.val().trim();
    var eSub = g_bDisplayPointUnits ? "" : elemEstSub.val().trim();

    function blankIfZero(str) {
        if (str == "0")
            return "";
        return str;
    }

    //in case user "Blanks" the field by typing zero, this wont confuse the parser if main has "."
    sMain = blankIfZero(sMain);
    sSub = blankIfZero(sSub);
    eMain = blankIfZero(eMain);
    eSub = blankIfZero(eSub);

    if (sSub.length>0 &&  (sMain.indexOf(".") >= 0 || sSub.indexOf(".") >= 0))
        return errorRet(sSub);
    if (eSub.length>0 &&  (eMain.indexOf(".") >= 0 || eSub.indexOf(".") >= 0))
        return errorRet(eSub);

    objRet.status = STATUS_OK;
    objRet.strS = sMain;
    if (sSub)
        objRet.strS = objRet.strS + ":" + sSub;
    objRet.strE = eMain;
    if (eSub)
        objRet.strE = objRet.strE + ":" + eSub;
    return objRet;
}

var g_timeoutUpdateCurrentSEData = null;
function updateCurrentSEData(page, bForceNow, bShowErrors, bDontSaveToStorage) {
    if (g_timeoutUpdateCurrentSEData) {
        clearTimeout(g_timeoutUpdateCurrentSEData);
        g_timeoutUpdateCurrentSEData = null;
    }

    function worker() {
        var idCardCur = g_stateContext.idCard;
        if (!idCardCur)
            return false;

        var elemUser = page.find("#plusCardCommentUser");
        var elemDate = page.find("#plusCardCommentDays");
        var valComment = page.find("#plusCardCommentNote").val() || "";
        var valUser = elemUser.val() || "";
        var valDays = elemDate.val() || "";
        var valKeyword = page.find("#plusCardCommentKeyword").val() || "";

        if (valUser == g_strUserOtherOption || valDays == g_strDateOtherOption)
            return false;

        var objSE = getSEStringsFromEdits(page, !bShowErrors);
        if (objSE.status != STATUS_OK)
            return false;

        g_currentCardSEData.setValues(!bDontSaveToStorage, idCardCur, valKeyword, valUser, valDays, objSE.strS, objSE.strE, valComment);
        return true;
    }

    if (bForceNow) {
        return worker();
    }
    else {
        assert(!bShowErrors);
        g_timeoutUpdateCurrentSEData = setTimeout(worker, 300); //fast-typing users shall not suffer
    }
    return true;
}


function handleSEBar(page, panelAddSE) {
    var idCardCur = g_stateContext.idCard;
    var elemSpentMain = panelAddSE.find("#plusCardCommentSpent");
    var elemSpentSub = panelAddSE.find("#plusCardCommentSpent2");
    var elemEstMain = panelAddSE.find("#plusCardCommentEst");
    var elemEstSub = panelAddSE.find("#plusCardCommentEst2");
    var elemNote = panelAddSE.find("#plusCardCommentNote");
    var listKeywords = page.find("#plusCardCommentKeyword").selectmenu("enable");
    var listUsers = page.find("#plusCardCommentUser").selectmenu("enable");
    var listDays = page.find("#plusCardCommentDays").selectmenu("enable");
    var bChanged = false;
    var msWaitMessage = 3000; //both draft message and hilite wait time must be the same to satisfy the eye

    function hilite(elem) {
        hiliteOnce(elem, msWaitMessage);
        bChanged = true;
    }

    //load draft
    g_currentCardSEData.loadFromStorage(idCardCur, function () {
        if (g_currentCardSEData.idCard != idCardCur)
            return; //timing when storage is async
        bChanged = false;
        if (!g_currentCardSEData.s && !g_currentCardSEData.e) {
            setTimeout(function () {
                if (isCordova())
                    cordova.plugins.Focus.focus(panelAddSE);
                else
                    elemSpentMain.focus();
            }, isMobile()? g_delayKB:10);
        }

        var keywords = getAllKeywords();
        if (keywords.length > 0) {
            if (g_currentCardSEData.keyword && keywords[0] != g_currentCardSEData.keyword) {
                listKeywords.val(g_currentCardSEData.keyword).selectmenu('refresh');
                if (listKeywords.val() != g_currentCardSEData.keyword) {
                    return; //keyword no longer used. ignore
                }
                hilite(listKeywords);
            } else {
                listKeywords.val(keywords[0]);
            }
        }

        if (g_currentCardSEData.user && g_currentCardSEData.user != g_strUserMeOption) {
            listUsers.val(g_currentCardSEData.user).selectmenu('refresh');
            if (listUsers.val() != g_currentCardSEData.user) {
                g_recentUsers.markRecent(g_currentCardSEData.user, null, new Date().getTime(), true);
                fillUserList(listUsers, g_currentCardSEData.user);
            }
            hilite(listUsers);
        } else {
            listUsers.val(g_strUserMeOption);
        }

        if (g_currentCardSEData.delta && g_currentCardSEData.delta != "0") {
            listDays.val(g_currentCardSEData.delta).selectmenu('refresh');
            if (listDays.val() != g_currentCardSEData.delta) {
                g_valDayExtra = g_currentCardSEData.delta;
                fillDaysList(listDays, g_currentCardSEData.delta);
            }
            hilite(listDays);
        } else {
            listDays.val("0");
        }

        var parts = null;
        if (g_currentCardSEData.s) {
            if (g_bDisplayPointUnits) {
                elemSpentMain.val(parseFixedFloat(g_currentCardSEData.s));
                hilite(elemSpentMain);
            }
            else {
                parts = splitUnitParts(g_currentCardSEData.s);
                elemSpentMain.val(parts[0]);
                if (parts[0])
                    hilite(elemSpentMain);
                elemSpentSub.val(parts[1]);
                if (parts[1])
                    hilite(elemSpentSub);
            }
        } else {
            elemSpentMain.val("");
            elemSpentSub.val("");
        }

        if (g_currentCardSEData.e) {
            if (g_bDisplayPointUnits) {
                elemEstMain.val(parseFixedFloat(g_currentCardSEData.e));
                hilite(elemEstMain);
            }
            else {
                parts = splitUnitParts(g_currentCardSEData.e);
                elemEstMain.val(parts[0]);
                if (parts[0])
                    hilite(elemEstMain);
                elemEstSub.val(parts[1]);
                if (parts[1])
                    hilite(elemEstSub);
            }
        } else {
            elemEstMain.val("");
            elemEstSub.val("");
        }

        elemNote.val(g_currentCardSEData.note || "");
        if (g_currentCardSEData.note)
            hilite(elemNote);
        updateNoteR(page, true);
        if (bChanged)
            alertMobile("Enter this draft", msWaitMessage);
    });

    //OK
    panelAddSE.find("#plusCardCommentEnterButton").off("click").click(function (event) {
        if (!updateCurrentSEData(page, true, true)) //save to storage now (not async)
            return;
        var idCardCur = g_currentCardSEData.idCard;
        //review: would be nice to use window.navigator.onLine but on Chrome it was returning false when online :(

        if (g_seCard.isNull() || !g_seCard.isFresh()) {
            //can happen when offline when the page was loaded from cache. try again.
            var container = page.find("#seContainer");
            var tbody = container.children("table").children("tbody");
            assert(g_lastPageInfo.params);
            assert(g_lastPageInfo.idPage == "pageCardDetail" && g_lastPageInfo.params);
            var params = getUrlParams(g_lastPageInfo.params);
            assert(params.id == idCardCur);
            fillSEData(page, container, tbody, params, false, function (cRows, bCached) {
                assert(!bCached);
                assert(!g_seCard.isNull() && g_seCard.isFresh());
                doit();
            }, true); //true means skip cache
        } else {
            doit();
        }

        function doit() {
            assert(!g_seCard.isVersion1()); //since its fresh, it cant have the old format from storage
            var mapSe = g_seCard.getSeCurForUser(g_currentCardSEData.user, g_currentCardSEData.keyword);
            var s = parseFixedFloat(g_currentCardSEData.s);
            var e = parseFixedFloat(g_currentCardSEData.e);
            if (s == 0 && e == 0 && g_currentCardSEData.note.trim().length == 0) {
                hiliteOnce(panelAddSE.find("#plusCardCommentSpent"), 500);
                hiliteOnce(panelAddSE.find("#plusCardCommentEst"), 500);
                return;
            }

            var sTotal = parseFixedFloat(mapSe.s + s);
            var eTotal = parseFixedFloat(mapSe.e + e);
            if (!verifyValidInput(sTotal, eTotal))
                return;

            if (g_currentCardSEData.note && g_currentCardSEData.note.trim().indexOf(PREFIX_PLUSCOMMAND) == 0) {
                alert("Plus commands (starting with " + PREFIX_PLUSCOMMAND + ") cannot be entered from the mobile app.");
                hiliteOnce(panelAddSE.find("#plusCardCommentNote"), 1500);
                return;
            }

            function onBeforeStartCommit() {
                enableSEFormElems(false, page, true);
            }

            function onFinished(bOK, data) {
                if (!bOK) {
                    alertMobile("Error entering S/E", 4000);
                    enableSEFormElems(true, page, true);
                    return;
                }
                var user = data.member;
                var sParsed = parseFixedFloat(g_currentCardSEData.s);
                var eParsed = parseFixedFloat(g_currentCardSEData.e);
                var eFirstParsed = 0;
                if (g_seCard.isRecurring() || !g_seCard.isUserMapped(user))
                    eFirstParsed = eParsed;
                g_recentRows.pushRow(idCardCur, Date.now(), user, g_currentCardSEData.keyword, sParsed, eParsed, eFirstParsed != 0);
                var bOutOfContext = (g_stateContext.idPage != "pageCardDetail" || idCardCur != g_stateContext.idCard);

                if (bOutOfContext) {
                    alertMobile("Entered S/E OK", 2000);
                    return;
                }

                panelAddSE.find("#plusCardCommentUser").val(g_strUserMeOption);
                panelAddSE.find("#plusCardCommentDays").val("0"); //now .note the chrome extension uses g_strNowOption as value
                panelAddSE.find("#plusCardCommentSpent").val("");
                panelAddSE.find("#plusCardCommentSpent2").val("");
                panelAddSE.find("#plusCardCommentEst").val("");
                panelAddSE.find("#plusCardCommentEst2").val("");
                panelAddSE.find("#plusCardCommentNote").val("");
                g_seCard.setSeCurForUser(user, g_currentCardSEData.s, g_currentCardSEData.e, g_currentCardSEData.keyword);
                if (eFirstParsed)
                    g_seCard.setEFirstForUser(user, eFirstParsed);
                g_currentCardSEData.removeValue(idCardCur); //forget draft
                cancelPaneEdit(false);

            }
            setNewCommentInCard(idCardCur, g_currentCardSEData.keyword, g_currentCardSEData.s, g_currentCardSEData.e, g_currentCardSEData.note,
                g_currentCardSEData.delta, g_currentCardSEData.user, onBeforeStartCommit, onFinished);
        }
    });

    function cancelPaneEdit(bUpdateCurrentSEData) {
        g_fnCancelSEBar = null;
        if (bUpdateCurrentSEData)
            updateCurrentSEData(page, true);
        var delay = g_delayKB * 2;
        if (g_bNoAnimationDelay || g_bNoAnimations || !isMobile()) {
            g_bNoAnimationDelay = false;
            delay = 0;
        }
        setTimeout(function () {
            resetSEPanel(page);
        }, delay);
    }

    //CANCEL
    panelAddSE.find("#plusCardCommentCancelButton").off("click").click(function (event) {
        cancelPaneEdit(true);
        event.stopPropagation();
        event.preventDefault();
        return false;
    });

    var allSEInputs = elemSpentMain.add(elemSpentSub).add(elemEstMain).add(elemEstSub); //numeric inputs
    //selection on focus helps in case card is recurring, user types S and clicks on E to type it too. since we typed it for them, might get unexpected results
    allSEInputs.off("focus").on("focus", function () { $(this).select(); });
    elemSpentMain.add(elemSpentSub).off("input").on("input", function () { updateEOnSChange(page); });
    elemEstMain.add(elemEstSub).off("input").on("input", function () { updateNoteR(page); });
    elemNote.off("input").on("input", function () { updateCurrentSEData(page); });
}

function resetSEPanel(page) {
    unhookBack();
    page.find("#panelAddSEContainer").removeClass("shiftUp");
    page.find("#cardBottomContainer").removeClass("plusShiftBottom");
    page.find(".cardBackground").removeClass("backgroundShader");
    page.find("#seContainer table").removeClass("backgroundShader");
    page.find("#seContainer table th").removeClass("backgroundShader");
    page.find("#seContainer table td").removeClass("backgroundShader");
    page.find("#panelAddSE").removeClass("opacityFull").addClass("opacityZero");
    enableSEFormElems(false, page);
}


function loadCardPage(page, params, bBack, urlPage) {
    assert(params.id); //note that the rest of params could be missing on some cases (cold navigation here from trello app)
    g_recentRows.init(); //we delay loading this until the first card page is loaded
    var idCardLong = params.id;
    var cardCached = g_cardsById[idCardLong];
    if (cardCached) {
        params.name = cardCached.name;
        params.nameList = cardCached.nameList;
        params.nameBoard = cardCached.nameBoard;
        params.shortLink = cardCached.shortLink;
    }
    var card = page.find("#cardTitle");
    var container = page.find("#seContainer");
    //warning: params is changed as data is refreshed. make sure to always use params and not a local cached value
    container.hide();
    page.find("#cardDesc").hide();
    var tbody = container.children("table").children("tbody");
    var elemBoard = page.find("#cardBoard");
    var elemList = page.find("#cardList");

    function updateTexts() {
        var strUnknown = "..."; //shows while values load from trello. could stay like that on some offline scenarios.
        elemBoard.text(params.nameBoard || strUnknown);
        elemList.text(params.nameList || strUnknown);
        card.text(params.name || strUnknown);
    }
    tbody.empty();
    updateTexts();

    function refreshSE(bSlide) {
        fillSEData(page, container, tbody, params, bBack, function (cRows, bCached) {
            //params have been updated. Update the card cache as well
            //review zig: ugly. sometimes we have a partial cache
            if (!cardCached || !bCached || !!cardCached.name || !cardCached.nameList || !cardCached.nameBoard) {
                cardCached = {
                    name: params.name,
                    nameList: params.nameList,
                    nameBoard: params.nameBoard,
                    shortLink: params.shortLink
                };
                g_cardsById[params.id] = cardCached;
                g_mapShortLinks.setCardId(params.shortLink, params.id);
            }
            updateTexts();
            if (!bCached) {
                g_pinnedCards.updatePinned(params.id, params.name, params.nameList, params.nameBoard); //handle trello renames etc
            }
            if (cRows == 0) {
                container.hide();
                return;
            }

            if (container.is(":visible"))
                return;

            if (bSlide && !bBack)
                container.slideDown(200);
            else
                container.show();
        });
    }

    function setLocalNotification(idNotification, bPinned) {
        if (!idNotification)
            return;

        if (!g_bLocalNotifications) {
            if (!window.Notification)
                return;


            //firefox support for requireInteraction: in mozilla52 https://bugzilla.mozilla.org/show_bug.cgi?id=862395 https://wiki.mozilla.org/RapidRelease/Calendar
            var matchFF = window.navigator.userAgent.match(/Firefox\/([0-9]+)\./);
            var verFF = matchFF ? parseInt(matchFF[1],10) : 0;
            if (verFF > 0 && verFF < 52)
                return;
            if (!navigator.serviceWorker || !navigator.serviceWorker.ready)
                return; //no API support

            Notification.requestPermission(function (status) {  // status is "granted", if accepted by user
                if (status != "granted")
                    return;
                if (bPinned) {
                    navigator.serviceWorker.ready.then(function (registration) {
                        if (!registration.showNotification || !registration.getNotifications)
                            return; //lame browser
                        registration.showNotification(params.name, {
                            body: params.nameBoard,
                            icon: '../img/icon192.png',
                            tag: idNotification,
                            silent: true,
                            requireInteraction: true,
                            data: { idCardLong: idCardLong, action: "pinnedCard" }
                        });
                    });
                } else {
                    navigator.serviceWorker.ready.then(function (registration) {
                        registration.getNotifications({ tag: idNotification }).then(function (list) {
                            if (list && list.length > 0)
                                list[0].close();
                        });
                    });
                }
            });

            return;
        }

        assert(g_bLocalNotifications);
        if (bPinned) {
            var url = urlPage;
            //clean up url so it starts with the page
            var strFind = "/www/";
            var iFind = url.lastIndexOf(strFind); //on android 4.0, the url is built differently and www appears twice

            if (iFind >= 0) {
                url = url.substr(iFind + strFind.length);
            }
            cordova.plugins.notification.local.registerPermission(function (granted) {
                if (!granted)
                    return;

                //https://github.com/katzer/cordova-plugin-local-notifications/wiki/04.-Scheduling
                var objNotif = {
                    id: idNotification,
                    text: params.nameBoard,
                    title: params.name,
                    ongoing: true, //review iOS
                    data: { url: url, action: "pinnedCard" },
                    sound: null,
                    smallIcon: "res://notif_pin", //https://romannurik.github.io/AndroidAssetStudio/icons-notification.html#source.type=image&source.space.trim=1&source.space.pad=0&name=notif_pin
                    icon: "res://icon"
                };

                cordova.plugins.notification.local.schedule(objNotif);           
            });
        }
        else {
            cordova.plugins.notification.local.cancel(idNotification, function () {
                // The notification has been cancelled
            });
        }
    }

    g_stateContext.idCard = idCardLong;
    refreshSE(!g_bNoAnimations && g_transitionLastForward != "none");
    var elemPin = page.find("#cardPin");
    elemPin.flipswitch();
    var idNotification = g_pinnedCards.getIdNotification(idCardLong);
    elemPin[0].checked = (idNotification != null);
    elemPin.flipswitch("refresh");
    elemPin.off("change.plusForTrello").on("change.plusForTrello", function () {
        var bChecked = elemPin.is(':checked');
        idNotification = g_pinnedCards.pin(params.name, params.nameList, params.nameBoard, idCardLong, params.shortLink, bChecked);
        if (idNotification)
            setLocalNotification(idNotification, bChecked);
        else {
            assert(false);
        }
      
    });

    var paramsAnim = { duration: 200, easing: "linear" };

    enableSEFormElems(false, page);
    var cTimesClickedAdd = 0;
    var bNeedBounceFocus = false;
    var panelAddSE = page.find($("#panelAddSE"));

    //this is part of the hack to get the focus event into the spent box and display the android numeric keyboard
    //we simulate a click with the "focus" plugin https://github.com/46cl/cordova-android-focus-plugin/
    //which gives us the right to simulate other user events like "focus" to bring the keyboard up.
    page.find("#panelAddSE").off("click").click(function (event) {
        if (bNeedBounceFocus) {
            bNeedBounceFocus = false;
            //$("#panelAddSE").find("input,select").removeClass("disabledClicks");
            $("#plusCardCommentSpent").focus();
            event.stopPropagation();
            event.preventDefault();
            return false;
        }
    });

    page.find("#addSE").off("click").click(function (event) {
        hookBack();
        event.stopPropagation();
        event.preventDefault();
        cTimesClickedAdd++;
        enableSEFormElems(true, page, cTimesClickedAdd > 1);
        bNeedBounceFocus = isCordova();
        page.find("#panelAddSEContainer").addClass("shiftUp");
        page.find("#cardBottomContainer").addClass("plusShiftBottom");
        var panelAddSE = page.find("#panelAddSE");
        panelAddSE.addClass("opacityFull").removeClass("opacityZero");
        page.find(".cardBackground").addClass("backgroundShader");
        page.find("#seContainer table").addClass("backgroundShader");
        page.find("#seContainer table th").addClass("backgroundShader");
        page.find("#seContainer table td").addClass("backgroundShader");
        
        page.find("#seBarFeedback").off("click").click(function () {
            var appInBrowserSurvey = openNoLocation("https://docs.google.com/forms/d/1pIChF9MsRirj7OnF7VYHpK0wbGu9wNpUEJEmLQfeIQc/viewform?usp=send_form");
        });

        function cancelSEBar() {
            g_fnCancelSEBar = null;
            resetSEPanel(page);
        }

        g_fnCancelSEBar = cancelSEBar;
        handleSEBar(page, panelAddSE);
        return false;
    });
    
   
    if (g_bNoAnimations)
        page.find(".animateTransitions").removeClass("animateTransitions").addClass("undoAnimateTransitions");
    else
        page.find(".undoAnimateTransitions").addClass("animateTransitions");


    page.find("#openTrelloCard").off("click").click(function (event) {
        var urlCard = "https://trello.com/c/" + params.shortLink;
        if (isCordova()) {
            window.plugins.webintent.startActivity({
                action: window.plugins.webintent.ACTION_VIEW,
                url: urlCard
            },
            function () { },
            function (e) { alertMobile('Could not open card'); }
        );
        }
        else {
            window.open(urlCard, '_blank');
        }

        event.stopPropagation();
        event.preventDefault();
        return false;
    });
    //why show? we special-case the card page to allow bookmarking it. in redirector.js we detect and redirect to index so it navigates properly.
    //however, that means that when the card.html page loads by itself, it will display ugly as it didnt go through index first for jqm.
    //the quick solution is to display:none in the card.html, then here show the page. Thus a refresh only shows a blank page and quickly redirects.
    page.show();
}

function setNewCommentInCard(idCardCur, keywordUse, //blank uses default (first) keyword
    sStr, eStr, //note: unlike extension code, this one takes strings which could include colon etc
    commentBox,
    prefix, //days 
    member, //null means current user
    onBeforeStartCommit, //called before all validation passed and its about to commit
    onFinished) {        //called after commit finished or failed. onFinished(bOK)
    if (prefix == "0" || prefix == null)
        prefix = "";
    var comment = ""; //trello card comment to add
    var prefixComment = ""; //for transfer command

    if (!g_user) {
        onFinished(false);
        return;
    }
       
    if (!keywordUse) {
        var kws = getAllKeywords(false);
        if (kws.length > 0)
            keywordUse = kws[0];
        else {
            assert(false);
            onFinished(false);
            return;
        }
    }
    sStr = "" + sStr;
    eStr = "" + eStr;
    var sParts = splitUnitParts(sStr);
    var eParts = splitUnitParts(eStr);
    if (sParts[0]) {
        assert(sParts[1].indexOf(".") < 0);
        sParts[0] = ""+parseFixedFloat(sParts[0]); //normalize decimals
    }
    if (eParts[0]) {
        assert(eParts[1].indexOf(".") < 0);
        eParts[0] = ""+parseFixedFloat(eParts[0]); //normalize decimals
    }

    comment = keywordUse + " ";

    if (member == g_strUserMeOption)
        member = null; //defaults later to user
    if (member && member.toLowerCase() != g_user.username.toLowerCase())
        comment = comment + "@" + member + " ";
    if (prefix.length > 0)
        comment = comment + " -" + prefix + "d ";  //in chrome extension, the prefix already contains the format -xd
    
    var s = sParts[0];
    if (sParts[1])
        s = s + ":" + sParts[1];
    var e = eParts[0];
    if (eParts[1])
        e = e + ":" + eParts[1];
    comment = comment + s + "/" + e + " " + prefixComment + commentBox;
    doEnterSEIntoCard(s, e, comment, idCardCur, keywordUse, member, onBeforeStartCommit, onFinished);
}

function doEnterSEIntoCard(s, e, comment, idCard, keyword, member, onBeforeStartCommit, onFinished) {
    //weird function names is to match the older chrome extension commit structure
    handleEnterCardComment(comment, idCard, s, e, keyword, member, onBeforeStartCommit, onFinished);
}

function handleEnterCardComment(comment, idCard, s, e, keyword, member, onBeforeStartCommit, onFinished) {

    assert(onFinished);
    if (onBeforeStartCommit)
        onBeforeStartCommit();

    function finished(bOK) {
        onFinished(bOK, !bOK? null : { member: member });
    }

        addCardCommentByApi(idCard, comment, function (response) {
            if (response.status != STATUS_OK) {
                alertMobile("Failed to enter S/E: " + response.status);
                finished(false);
                return;
            }

            if (!member)
                member = response.obj.memberCreator.username;
            postAddCardComment(response.obj.id);
        });

        function postAddCardComment(idHistoryRowUse) {
            //s, e, member, idHistoryRowUse, keyword
            finished(true);
        }
}

var g_bBackHooked=false;

function onBackKeyDown() {
    var elem = $("#plusCardCommentCancelButton");
    if (elem.length > 0) {
        g_bNoAnimationDelay = true;
        elem.eq(0).click();
    }
}

function hookBack() {
    if (g_bBackHooked)
        return;
    g_bBackHooked=true;
    document.addEventListener("backbutton", onBackKeyDown, false);
}

function unhookBack() {
    if (!g_bBackHooked)
        return;
    g_bBackHooked = false;
    document.removeEventListener("backbutton", onBackKeyDown, false);
}

function fillDaysList(listDays, cDaySelected) {
    function appendDay(cDay, cDaySelected) {
        var nameOption = null;
        var bSelected = (cDay == cDaySelected);
        if (cDay == g_strDateOtherOption) {
            nameOption = cDay;
        }
        else if (cDay == 0)
            nameOption = "now";
        else
            nameOption = "-" + cDay + "d";
        var item = $("<option value='" + cDay + "'" + (bSelected ? " selected='selected'" : "") + ">" + nameOption + "</option>");
        listDays.append(item);
    }

    listDays.empty();
    for (var iDay = 0; iDay <= g_valMaxDaysCombo; iDay++)
        appendDay(iDay, cDaySelected);
    if (g_valDayExtra)
        appendDay(g_valDayExtra, cDaySelected);
    appendDay(g_strDateOtherOption, 0); //0 so it never selects it
    listDays.selectmenu("refresh");
}

function fillKeywords(listKeywords, keywordSelected) {
    function appendKeyword(keyword, bSelected) {
        var item = $("<option value='" + keyword + "'" + (bSelected ? " selected='selected'" : "") + ">" + keyword + "</option>");
        listKeywords.append(item);
    }
    var rgKeywords = getAllKeywords(true);
    rgKeywords.forEach(function (keyword) {
        appendKeyword(keyword, keywordSelected && keywordSelected == keyword);
    });

    listKeywords.selectmenu("refresh");
    if (rgKeywords.length < 2)
        listKeywords.parent().hide();
    else
        listKeywords.parent().show();
}

function fillUserList(listUsers, userSelected) {
    function appendUser(name, bSelected) {
        var item = $("<option value='" + name + "'" + (bSelected ? " selected='selected'" : "") + ">" + name + "</option>");
        listUsers.append(item);
    }

    listUsers.empty();
    g_recentUsers.users.sort(function (a, b) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    appendUser(g_strUserMeOption);
    var userGlobal = getUserGlobal();
    appendUser(userGlobal);
    g_recentUsers.users.forEach(function (user) {
        var nameUse = user.name.toLowerCase();
        if (nameUse == g_strUserMeOption || nameUse == userGlobal)
            return;
        if (g_user && g_user.username.toLowerCase() == nameUse)
            return;
        appendUser(nameUse, userSelected && userSelected == nameUse);
    });

    appendUser(g_strUserOtherOption);
    listUsers.selectmenu("refresh");
}

function enableSEFormElems(bEnable,
    page,
    bOnlyEnable) { //bOnlyEnable true and bEnable true will just show elements without repopulating (opt)
    var bAsPoints = g_bDisplayPointUnits;
    if (bEnable) {
        page.find(".seFormElem").removeAttr('disabled');
        page.find("#plusCardCommentEnterButton").removeClass("ui-disabled");
        page.find("#plusCardCommentCancelButton").removeClass("ui-disabled");
        var listKeywords = page.find("#plusCardCommentKeyword").selectmenu("enable");
        var listUsers = page.find("#plusCardCommentUser").selectmenu("enable");
        var listDays = page.find("#plusCardCommentDays").selectmenu("enable");

        if (bOnlyEnable) {
            listUsers[0].selectedIndex = 0;
            listDays[0].selectedIndex = 0;
            listUsers.selectmenu("refresh");
            listDays.selectmenu("refresh");
            return;
        }

        function setUnitLabels() {
            var u = UNITS.getCurrentShort(bAsPoints);
            var su = UNITS.GetSubUnit() + " ";
            var container = page.find("#panelAddSE");
            container.find("#spentUnit").text(u);
            container.find("#estUnit").text(u);
            if (bAsPoints) {
                container.find("#seSeparator").hide();
                container.find("#spentSubUnit").hide();
                container.find("#estSubUnit").hide();
                container.find("#plusCardCommentSpent2").hide();
                container.find("#plusCardCommentEst2").hide();
            } else {
                container.find("#seSeparator").show();
                container.find("#plusCardCommentSpent2").show();
                container.find("#spentSubUnit").text(su).show();
                container.find("#plusCardCommentEst2").show();
                container.find("#estSubUnit").text(su).show();
            }
        }

        setUnitLabels();

        fillKeywords(listKeywords);
        listKeywords.off("change.plusForTrello").on("change.plusForTrello", function () {
            updateNoteR(page);
        });
        fillUserList(listUsers);
        listUsers.off("change.plusForTrello").on("change.plusForTrello", function () {
            var combo = $(this);
            var val = combo.val();
            updateNoteR(page);
            if (val && val == g_strUserOtherOption) {
                function process(userNew) {
                    if (userNew)
                        userNew = userNew.trim().toLowerCase();
                    if (userNew)
                        g_recentUsers.markRecent(userNew, null, new Date().getTime(), true);
                    fillUserList(listUsers, userNew);
                    updateNoteR(page);
                }

                if (typeof (navigator) != "undefined" && navigator.notification) {
                    navigator.notification.prompt(
                        "Type username",  // message
                        function onPrompt(results) {
                            var text = null;
                            if (results.buttonIndex == 1)
                                text = results.input1;
                            process(results.input1);
                        },                  // callback to invoke
                        'User name',            // title
                        ['Ok', 'Cancel'],             // buttonLabels
                        "");                // defaultText
                }
                else {
                    process(prompt("Type username", ""));
                }
            } else {
                updateNoteR(page);
            }
        });

        fillDaysList(listDays);
        listDays.off("change.plusForTrello");
        listDays.on("change.plusForTrello", function () {
            var combo = $(this);
            var val = combo.val();
            updateCurrentSEData(page);
            if (!val)
                return;
            if (val == g_strDateOtherOption) {
                function process(dayNew) {
                    if (dayNew) {
                        if (dayNew > g_valMaxDaysCombo)
                            g_valDayExtra = dayNew;
                    }
                    fillDaysList(listDays, dayNew);
                }

                var dateNow = new Date();
                var options = {
                    date: dateNow,
                    mode: 'date',
                    maxDate: dateNow.getTime()
                };

                if (typeof (datePicker) != "undefined") {
                    datePicker.show(options, function (date) {
                        if (!date || date == "cancel") {
                            date = "";
                        }
                        else if (date > dateNow) {
                            alert("Date must be in the past");
                            date = null;
                        }
                        else {
                            var date1 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
                            var date2 = Date.UTC(dateNow.getFullYear(), dateNow.getMonth(), dateNow.getDate());
                            var ms = Math.abs(date1 - date2);
                            date = Math.floor(ms / 1000 / 60 / 60 / 24);
                        }
                        process(date);
                    });
                }
                else {
                    var strValDelta = prompt("enter positive delta", "");
                    process(parseInt(strValDelta, 10) || 0);
                }
            }
        });

    } else {
        page.find(".seFormElem").attr('disabled', 'disabled');
        page.find("#plusCardCommentKeyword").selectmenu("disable");
        page.find("#plusCardCommentUser").selectmenu("disable");
        page.find("#plusCardCommentDays").selectmenu("disable");
        page.find("#plusCardCommentEnterButton").addClass("ui-disabled");
        page.find("#plusCardCommentCancelButton").addClass("ui-disabled");
    }
}

function fillSEData(page, container, tbody, params, bBack, callback, bNoCache) {
    var idCard = params.id;
    g_seCard.setNull(); //means pending to load data
    assert(!g_seCard.isFresh());
    function appendRow(tbody, user, s, eFirst, e, r) {
        var row = $("<tr>");
        row.append("<td class='colUser'>" + user + "</td>");
        row.append("<td class='colSSum'>" + s + "</td>");
        row.append("<td class='colEFirst'>" + eFirst + "</td>");
        row.append("<td class='colESum'>" + e + "</td>");
        row.append("<td class='colR'>" + r + "</td>");
        tbody.append(row);
    }

    g_stateContext.idCard = idCard;
    //on back, dont call trello, rely on cache only
    callTrelloApi("cards/" + idCard + "?actions=commentCard&actions_limit=900&fields=name,desc&action_fields=data,date,idMemberCreator&action_memberCreator_fields=username&board=true&board_fields=name&list=true&list_fields=name", true, bBack ? -1 : 200,
        callbackTrelloApi, false, null, bNoCache || false);
    // bReturnErrors, waitRetry, bSkipCache,
    //context, bReturnOnlyCachedIfExists, callbackOnUnchanged, bDontStoreInCache, bDontRetry, bPost
    function callbackTrelloApi(response, responseCached) {
        var rgComments = [];
        var rgRows = [];
        var objReturn = {};
        if (response.objTransformed) {
            assert(response.bCached);
            rgRows = response.objTransformed.rgRows;
            var rgRowsExtra = g_recentRows.get(idCard);
            if (rgRowsExtra.length > 0) {
                var rowExtra;
                var rgCommentsPatch = [];
                for (var iRE = 0; iRE < rgRowsExtra.length; iRE++) {
                    rowExtra = rgRowsExtra[iRE];
                    rgCommentsPatch.push(makeHistoryRowObject(new Date(rowExtra.msDate), rowExtra.user, rowExtra.s, rowExtra.e, "", "1", rowExtra.keyword, null)); //"1" is a fake id, not used
                }
                rgRows = calculateCardSEReport(rgCommentsPatch, rgRows); //recalculate, but do not save it again to storage
            }
            objReturn.name = response.objTransformed.name;
            objReturn.nameList = response.objTransformed.nameList;
            objReturn.nameBoard = response.objTransformed.nameBoard;
            objReturn.desc = response.objTransformed.desc;

        } else {
            assert(!response.bCached);
            //update params.id, as we might have received a shortLink (currently does not happen)
            params.id = response.obj.id;
            idCard = params.id;
            var rgKeywords = getAllKeywords();
            var cActions = response.obj.actions.length;
            for (iAction = cActions - 1; iAction >= 0; iAction--) {
                var action=response.obj.actions[iAction];
                var rowsAdd = readTrelloCommentDataFromAction(action, response.obj.name, rgKeywords);
                rowsAdd.forEach(function (rowCur) {
                    if (!rowCur.bError)
                        rgComments.push(rowCur);
                });
            }

            rgRows = calculateCardSEReport(rgComments);
            objReturn.rgRows = rgRows;
            objReturn.name = response.obj.name;
            objReturn.nameList = response.obj.list.name;
            objReturn.nameBoard = response.obj.board.name;
            objReturn.desc = response.obj.desc;
            g_recentRows.remove(idCard); //remove now that we have a fresh copy
        }

        //review zig: ugly to have to update both objReturn and params
        params.name = objReturn.name;
        params.nameList = objReturn.nameList;
        params.nameBoard = objReturn.nameBoard;
        if (responseCached && JSON.stringify(responseCached.objTransformed) == JSON.stringify(objReturn)) {
            assert(!g_seCard.isNull());
            g_seCard.setFresh(true);
            return objReturn;
        }
        g_seCard.clear();
        g_seCard.setRecurring(params.name.indexOf(TAG_RECURRING_CARD) >= 0);

        if (!response.bCached)
            g_seCard.setFresh(true);

        page.find("#cardTitle").text(objReturn.name);
        
        var descElem = page.find("#cardDesc");
        if (!objReturn.desc)
            descElem.hide();
        else {
            var converter = new Markdown.Converter();
            descElem.html(converter.makeHtml(objReturn.desc));
            var elems = descElem.find("a");
            elems.click(function (e) {
                //prevent jqm from handling it.
                e.preventDefault();
                e.stopPropagation();
                var url = $(e.target).prop("href");
                var urlLower = url.toLowerCase();
                if (urlLower.indexOf("trello.com/" >= 0)) {
                    if (urlLower.indexOf("trello.com/b/") >= 0 || urlLower.indexOf("trello.com/c/") >= 0)
                        handleBoardOrCardActivity(url);
                    else
                        openNoLocation(url); //the trello app doesnt handle well activity links (other than boards or cards)
                }
                else
                    openUrlAsActivity(url); //better as activity so drive attachments etc open native
            });
            descElem.show();
        }
        rgRows.forEach(function (row) {
            var sLoop = parseFixedFloat(row.spent);
            var eLoop = parseFixedFloat(row.est);
            if (row.kw) { //version>=2 of data
                for (var kwLoop in row.kw) {
                    sLoop = parseFixedFloat(row.kw[kwLoop].spent);
                    eLoop = parseFixedFloat(row.kw[kwLoop].est);
                    g_seCard.setSeCurForUser(row.user, sLoop, eLoop, kwLoop);
                }
            } else {
                g_seCard.setSeCurForUser(row.user, sLoop, eLoop, null); //old version1 format without kw
            }
            var eFirstParsed = parseFixedFloat(row.estFirst);
            if (eFirstParsed)
                g_seCard.setEFirstForUser(row.user, eFirstParsed);
        });

        tbody.empty();
        g_seCard.forEachUser(function (user, row) {
            appendRow(tbody, user, row.s, row.eFirst || 0, row.e, parseFixedFloat(row.e - row.s));
        });
        callback(rgRows.length, response.bCached);
        return objReturn;
    }
}

function calculateCardSEReport(rgComments, rgRowsPatch) {
    //rgComments in date ascending (without -dX)
    var rgRows = [];
    var userSums = {};
    var bModifiedUsers = false;
    var iLoop;
    var user;
    var userRow;

    if (rgRowsPatch) {
        for (iLoop = 0; iLoop < rgRowsPatch.length; iLoop++) {
            userRow = rgRowsPatch[iLoop];
            userSums[userRow.user] = cloneObject(userRow);
        }
    }

    rgComments.forEach(function (row) {
        userRow=userSums[row.user];
        if (userRow) {
            if (!userRow.idUser && row.idUser)
                userRow.idUser = row.idUser;
            if (row.date>userRow.sDateMost)
                userRow.sDateMost = row.date;
        }
        else {
            //first estimate row
            userRow = {};
            userRow.idUser = row.idUser;
            userRow.spent = 0;
            userRow.est =  0;
            userRow.estFirst = 0;
            userRow.user = row.user;
            userRow.sDateMost = row.date;
            userRow.kw = {};   //note that existance of this property indicates it is version 2. Before 2017-01-03 it was not stored per-keyword. later we use this to detect stale serialized data.
            userSums[row.user] = userRow;
            row.bENew = true;
        }
        var keyword = row.keyword;
        userRow.spent = userRow.spent + row.spent;
        userRow.est = userRow.est + row.est;
        if (row.bENew)
            userRow.estFirst = userRow.estFirst + row.est;
        
        if (keyword) { //should always be one really as its card comment sync
            var mapKW = userRow.kw[keyword];
            if (!mapKW) {
                mapKW = {
                    spent:row.spent,
                    est: row.est
                };
                userRow.kw[keyword] = mapKW;
            } else {
                mapKW.spent = mapKW.spent + row.spent;
                mapKW.est = mapKW.est + row.est;
            }
        }
    });

    for (user in userSums) {
        var objSums = userSums[user];
        rgRows.push(objSums);
        if (g_recentUsers.markRecent(user, objSums.idUser||null, objSums.sDateMost * 1000, false)) {
            //review zig: add check for bFromCache so it doesnt do double work. not here yet because it would cause already-cached card data to
            //not go through here, because older versions didnt have this code to update the users list storage.
            //by june 2015 the check could be added and most users wont notice the issue
            //review 2 zig: cant see how to prevent the double check. we want to update when reading from cache but also when reading from trello if
            //plus users list changed in the card
            bModifiedUsers = true;
        }
    }

    if (bModifiedUsers)
        g_recentUsers.saveProp();

    rgRows.sort(function (a, b) {
        return b.sDateMost - a.sDateMost;
    });

    return rgRows;
}

function verifyValidInput(sTotal, eTotal) {
    var rTotal = parseFixedFloat(eTotal - sTotal);
    var err = null;
    if (sTotal < 0)
        err = "Spent total will go negative.";
    else if (eTotal < 0)
        err = "Estimate total will go negative.";
    else if (rTotal < 0 && !g_bAllowNegativeRemaining)
        err = "Spent total will be larger than estimate total.\nTo avoid this see Plus Preferences 'Allow negative Remaining'";

    if (err != null) {
        err = err + "\n\nAre you sure you want to enter this S/E row?";
        if (!confirm(err))
            return false;
    }
    return true;
}