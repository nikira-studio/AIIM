!macro customUnInstall
  ${IfNot} ${Silent}
    ${IfNot} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Also remove your AIIM buddies, chat history, memories, settings, and saved credentials?$\r$\n$\r$\nChoose No to keep them for a future reinstall." \
        IDNO aiim_keep_user_data

      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}

      aiim_keep_user_data:
    ${EndIf}
  ${EndIf}
!macroend
